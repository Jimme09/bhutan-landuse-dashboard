require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg"); // Manages connections to your PostgreSQL/PostGIS database

const app = express();
const PORT = 5000;

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
app.get("/api/v1/statistics/:regionName", async (req, res) => {
  const regionName = req.params.regionName;
  console.log(`[API Server] Request received for region: ${regionName}`);

  try {
    let queryText = "";
    let queryParams = [];

    // 2. Formulate the dynamic SQL block depending on the dropdown selection
    if (
      regionName === "National" ||
      regionName === "All Districts (National)"
    ) {
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
// <-- PASTE THE NEW /api/v1/change/:regionName ENDPOINT HERE -->

/**
 * TEMPORAL CHANGE-DETECTION ENDPOINT
 * Computes a land-use transition matrix between 2016 and 2020 for a given district
 */
app.get("/api/v1/change/:regionName", async (req, res) => {
  const regionName = req.params.regionName;
  console.log(
    `[API Server] Change-detection request for region: ${regionName}`,
  );

  try {
    let queryText = "";
    let queryParams = [];

    const baseQuery = `
      SELECT
        CASE WHEN a.class = 'Cultivated Agriculture' THEN 'Agriculture Land' ELSE a.class END AS class_2016,
        b.class_name AS class_2020,
        ROUND(SUM(ST_Area(ST_Intersection(a.geom, b.geom)::geography))::numeric / 1e6, 2) AS area_sqkm
      FROM bhutan.landuse_2016 a
      JOIN bhutan.landuse_2020 b ON ST_Intersects(a.geom, b.geom)
    `;

    if (
      regionName === "National" ||
      regionName === "All Districts (National)"
    ) {
      queryText = `
        ${baseQuery}
        GROUP BY class_2016, class_2020
        ORDER BY area_sqkm DESC;
      `;
    } else {
      queryText = `
        ${baseQuery}
        WHERE LOWER(a.dzgname) = LOWER($1)
        GROUP BY class_2016, class_2020
        ORDER BY area_sqkm DESC;
      `;
      queryParams = [regionName];
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
