require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg"); // Manages connections to your PostgreSQL/PostGIS database

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// 1. Configure the connection using your exact parameters from bhutan.map
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Test the database authentication immediately upon booting up the server
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ PostGIS Database connection failed:", err.message);
  } else {
    console.log("✅ Connected to PostGIS Database (bhutandb) successfully!");
  }
});

/**
 * LIVE API ENDPOINT
 * Fetches data directly from PostGIS and aggregates areas by landuse class name
 */

// Reconciles district-name spelling differences between the boundary layer
// (bhutan.dzongkhag) and the land-use data tables (bhutan.landuse_2020/2016),
// which use slightly different official spellings for the same districts.
const districtNameMap = {
  Mongar: "Monggar",
  "Samdrup Jongkhar": "Samdrupjongkhar",
  "Tashi Yangtse": "Trashiyangtse",
  Tashigang: "Trashigang",
  "Wangdue Phodrang": "Wangduephodrang",
};

function resolveDistrictName(name) {
  return districtNameMap[name] || name;
}

// Reverse lookup (data spelling -> boundary spelling), so responses keyed by
// district can be matched directly against the map's features.
const boundaryNameMap = Object.fromEntries(
  Object.entries(districtNameMap).map(([boundary, data]) => [data, boundary]),
);

function toBoundaryName(name) {
  return boundaryNameMap[name] || name;
}

// The 2016 layer (and the transition tables built from it) uses a third
// spelling for some districts, e.g. "Yangtse" instead of "Trashiyangtse".
const transitionNameMap = {
  Trashiyangtse: "Yangtse",
};

function toTransitionName(name) {
  return transitionNameMap[name] || name;
}

function isNational(regionName) {
  return regionName === "National" || regionName === "All Districts (National)";
}

// AI summaries are generated from static data, so cache them per region to
// avoid repeated (rate-limited) calls to the Groq API.
const insightsCache = new Map();
app.get("/api/v1/statistics/:regionName", async (req, res) => {
  const regionName = resolveDistrictName(req.params.regionName);
  console.log(`[API Server] Request received for region: ${regionName}`);

  try {
    let queryText = "";
    let queryParams = [];

    // 2. Formulate the dynamic SQL block depending on the dropdown selection
    if (isNational(regionName)) {
      queryText = `
                SELECT class_name, SUM(area_sqkm) as total_area
                FROM bhutan.landuse_2020
                GROUP BY class_name
                ORDER BY class_name;
            `;
    } else {
      // Parameterized query ($1) handles string safety and spaces cleanly
      queryText = `
                SELECT class_name, SUM(area_sqkm) as total_area
                FROM bhutan.landuse_2020
                WHERE LOWER(dzongkhag) = LOWER($1)
                GROUP BY class_name
                ORDER BY class_name;
            `;
      queryParams = [regionName];
    }

    // 3. Run the live query against your spatial table
    const dbResult = await pool.query(queryText, queryParams);

    if (dbResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: `No statistics found matching region: ${regionName}`,
      });
    }

    // 4. Map the database table rows into parallel arrays matching Chart.js structures
    const categories = dbResult.rows.map((row) => row.class_name);
    const values = dbResult.rows.map((row) =>
      parseFloat(row.total_area).toFixed(2),
    );

    // 5. Send the dynamic payload response straight back to your frontend js controller
    res.json({
      status: "success",
      region: regionName,
      categories: categories,
      values: values.map(Number), // Convert array elements from strings to numbers
    });
  } catch (error) {
    console.error("💥 PostGIS Query Error:", error.message);
    res
      .status(500)
      .json({ status: "error", error: "Internal Server Database Exception" });
  }
});
/**
 * GEOJSON ENDPOINT: Serves dzongkhag boundaries as GeoJSON for the
 * interactive (clickable) map layer, instead of static WMS tiles.
 */
app.get("/api/v1/geojson/dzongkhag", async (req, res) => {
  try {
    const queryText = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', jsonb_agg(
          jsonb_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(geom, 6)::jsonb,
            'properties', jsonb_build_object('dzongkhag', dzongkhag)
          )
        )
      ) AS geojson
      FROM bhutan.dzongkhag;
    `;
    const dbResult = await pool.query(queryText);
    res.json(dbResult.rows[0].geojson);
  } catch (error) {
    console.error("💥 GeoJSON Export Error:", error.message);
    res.status(500).json({
      status: "error",
      error: "Failed to export dzongkhag boundaries",
    });
  }
});

/**
 * GEOJSON ENDPOINT: Serves gewog (sub-district) boundaries as GeoJSON,
 * same pattern as the dzongkhag endpoint, for a labeled vector layer.
 */
app.get("/api/v1/geojson/gewog", async (req, res) => {
  try {
    const queryText = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', jsonb_agg(
          jsonb_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(geom, 6)::jsonb,
            'properties', jsonb_build_object('gewog', name_eng)
          )
        )
      ) AS geojson
      FROM bhutan.gewog;
    `;
    const dbResult = await pool.query(queryText);
    res.json(dbResult.rows[0].geojson);
  } catch (error) {
    console.error("💥 Gewog GeoJSON Export Error:", error.message);
    res.status(500).json({
      status: "error",
      error: "Failed to export gewog boundaries",
    });
  }
});

/**
 * CHOROPLETH DATA ENDPOINT
 * Returns one land-use class's area broken down by every district —
 * used to color the dzongkhag map based on a selected class.
 */
app.get("/api/v1/class-breakdown/:className", async (req, res) => {
  const className = req.params.className;
  console.log(`[API Server] Class breakdown request for: ${className}`);

  try {
    const queryText = `
      SELECT dzongkhag, SUM(area_sqkm) as total_area
      FROM bhutan.landuse_2020
      WHERE LOWER(class_name) = LOWER($1)
      GROUP BY dzongkhag
      ORDER BY dzongkhag;
    `;
    const dbResult = await pool.query(queryText, [className]);

    if (dbResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: `No data found for class: ${className}`,
      });
    }

    // Build a simple {districtName: area} lookup, keyed by the boundary
    // layer's spelling so the frontend can match map features by name.
    const breakdown = {};
    dbResult.rows.forEach((row) => {
      breakdown[toBoundaryName(row.dzongkhag)] = parseFloat(row.total_area);
    });

    res.json({
      status: "success",
      class_name: className,
      breakdown: breakdown,
    });
  } catch (error) {
    console.error("💥 PostGIS Class Breakdown Error:", error.message);
    res
      .status(500)
      .json({ status: "error", error: "Internal Server Database Exception" });
  }
});

/**
 * AI DISTRICT OVERVIEW ENDPOINT
 * Sends a district's land-use statistics to Groq's LLM API and returns
 * a natural-language summary of the district's land-use profile.
 */
app.get("/api/v1/insights/:regionName", async (req, res) => {
  const regionName = resolveDistrictName(req.params.regionName);
  console.log(`[API Server] AI insights request for: ${regionName}`);

  const national = isNational(regionName);
  const cacheKey = national ? "National" : regionName.toLowerCase();
  if (insightsCache.has(cacheKey)) {
    return res.json(insightsCache.get(cacheKey));
  }

  try {
    // 1. Gather the same statistics your pie chart already uses
    const statsQuery = national
      ? `
      SELECT class_name, SUM(area_sqkm) as total_area
      FROM bhutan.landuse_2020
      GROUP BY class_name
      ORDER BY total_area DESC;
    `
      : `
      SELECT class_name, SUM(area_sqkm) as total_area
      FROM bhutan.landuse_2020
      WHERE LOWER(dzongkhag) = LOWER($1)
      GROUP BY class_name
      ORDER BY total_area DESC;
    `;
    const statsResult = await pool.query(statsQuery, national ? [] : [regionName]);

    if (statsResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: `No statistics found for region: ${regionName}`,
      });
    }

    // Include each class's share of the total, so the LLM doesn't have to
    // do (and get wrong) the percentage arithmetic itself
    const totalArea = statsResult.rows.reduce(
      (sum, row) => sum + parseFloat(row.total_area),
      0,
    );
    const statsSummary = statsResult.rows
      .map((row) => {
        const area = parseFloat(row.total_area);
        const share = ((area / totalArea) * 100).toFixed(1);
        return `${row.class_name}: ${area.toFixed(2)} km² (${share}%)`;
      })
      .join(", ");

    // 2. Send those stats to Groq's LLM API as context, asking for a short summary
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content:
                "You are a geospatial analyst. Given land-use area statistics for a district in Bhutan (or for the whole country), write a concise 2-3 sentence summary describing its dominant land-use characteristics. Be factual and avoid speculation. Quote only the areas and percentages given; do not calculate new figures.",
            },
            {
              role: "user",
              content: national
                ? `Region: Bhutan (national, all districts). Land-use breakdown: ${statsSummary}`
                : `District: ${regionName}. Land-use breakdown: ${statsSummary}`,
            },
          ],
          // gpt-oss is a reasoning model: its hidden reasoning counts toward
          // max_tokens, so keep reasoning light and leave room for the answer
          reasoning_effort: "low",
          max_tokens: 1000,
        }),
      },
    );

    const groqData = await groqResponse.json();

    if (!groqResponse.ok) {
      console.error("💥 Groq API Error:", groqData);
      return res.status(502).json({
        status: "error",
        error: "AI insight generation failed",
      });
    }

    const summary = (groqData.choices?.[0]?.message?.content || "").trim();

    if (!summary) {
      console.error(
        "💥 Groq returned an empty summary. finish_reason:",
        groqData.choices?.[0]?.finish_reason,
      );
      return res.status(502).json({
        status: "error",
        error: "AI insight generation returned no text",
      });
    }

    const payload = {
      status: "success",
      region: regionName,
      summary: summary,
    };
    insightsCache.set(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error("💥 AI Insights Error:", error.message);
    res
      .status(500)
      .json({ status: "error", error: "Internal Server Exception" });
  }
});

/**
 * TEMPORAL CHANGE-DETECTION ENDPOINT
 * Computes a land-use transition matrix between 2016 and 2020 for a given district
 */
app.get("/api/v1/change/:regionName", async (req, res) => {
  const regionName = resolveDistrictName(req.params.regionName);
  console.log(
    `[API Server] Change-detection request for region: ${regionName}`,
  );

  try {
    let queryText = "";
    let queryParams = [];

    if (isNational(regionName)) {
      queryText = `
        SELECT class_2016, class_2020, area_sqkm
        FROM bhutan.national_transitions
        ORDER BY area_sqkm DESC;
      `;
    } else {
      queryText = `
        SELECT class_2016, class_2020, area_sqkm
        FROM bhutan.district_transitions
        WHERE LOWER(dzongkhag) = LOWER($1)
        ORDER BY area_sqkm DESC;
      `;
      queryParams = [toTransitionName(regionName)];
    }

    const dbResult = await pool.query(queryText, queryParams);

    if (dbResult.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: `No change data found for region: ${regionName}`,
      });
    }

    res.json({
      status: "success",
      region: regionName,
      transitions: dbResult.rows,
    });
  } catch (error) {
    console.error("💥 PostGIS Change Query Error:", error.message);
    res
      .status(500)
      .json({ status: "error", error: "Internal Server Database Exception" });
  }
});

// Default diagnostics root path
app.get("/", (req, res) => {
  res.send("Bhutan Dashboard Node Backend API Engine is fully operational!");
});

app.listen(PORT, () => {
  console.log(
    `🚀 Node backend engine running smoothly at http://127.0.0.1:${PORT}`,
  );
});
