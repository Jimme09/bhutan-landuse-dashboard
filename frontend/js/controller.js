/**
 * MVC CONTROLLER COMPONENT
 * global variables
 */
let olMap;
let activeWmsOverlay; // Tracks the current active MapServer WMS layer
let statsChart;
let changeChart; // Tracks the land-use change (2016-2020) bar chart instance
let dzongkhagLayer; // Tracks the clickable dzongkhag boundary layer, needed for choropleth recoloring

document.addEventListener("DOMContentLoaded", async function () {
  initSpatialMap();

  // 1. Initialize the chart instance with a blank state
  initDataCharts();
  initChangeChart();

  // 2. Automatically request National metrics on dashboard startup
  await triggerStatisticsRefresh("National");
  await triggerChangeRefresh("National");

  bindUserActionInterceptors();
});

function initSpatialMap() {
  const bhutanCoordinates = ol.proj.fromLonLat([90.4, 27.51]);

  // 1. Define the plain basemap
  const plainBasemap = new ol.layer.Tile({
    source: new ol.source.XYZ({
      url: "https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      attributions: "© CartoDB",
    }),
    visible: true,
  });

  // 2. Initialize the map with the plain basemap
  olMap = new ol.Map({
    target: "map-workspace",
    layers: [plainBasemap],
    view: new ol.View({ center: bhutanCoordinates, zoom: 8.2 }),
  });

  // 3. Link the checkbox to the layer visibility
  document
    .getElementById("basemap-toggle")
    .addEventListener("change", function (event) {
      plainBasemap.setVisible(event.target.checked);
    });

  // 4. Load dzongkhag boundaries as a clickable GeoJSON vector layer
  const dzongkhagSource = new ol.source.Vector({
    url: "http://127.0.0.1:5000/api/v1/geojson/dzongkhag",
    format: new ol.format.GeoJSON(),
  });

  dzongkhagLayer = new ol.layer.Vector({
    source: dzongkhagSource,
    style: function (feature) {
      return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: "#1d88e5", width: 1.5 }),
        fill: new ol.style.Fill({ color: "rgba(29, 136, 229, 0.08)" }),
        text: new ol.style.Text({
          text: feature.get("dzongkhag"),
          font: "bold 11px sans-serif",
          fill: new ol.style.Fill({ color: "#212529" }),
          stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
          overflow: true,
        }),
      });
    },
  });
  olMap.addLayer(dzongkhagLayer);

  // 5. Enable click-to-select on dzongkhag features
  const dzongkhagSelect = new ol.interaction.Select({
    layers: [dzongkhagLayer],
    style: function (feature) {
      return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: "#c0392b", width: 3 }),
        fill: new ol.style.Fill({ color: "rgba(192, 57, 43, 0.15)" }),
        text: new ol.style.Text({
          text: feature.get("dzongkhag"),
          font: "bold 11px sans-serif",
          fill: new ol.style.Fill({ color: "#212529" }),
          stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
          overflow: true,
        }),
      });
    },
  });
  olMap.addInteraction(dzongkhagSelect);

  dzongkhagSelect.on("select", async function (event) {
    if (event.selected.length === 1) {
      const clickedDistrict = event.selected[0].get("dzongkhag");
      console.log(
        `[Controller] Map click selected district: ${clickedDistrict}`,
      );

      // Sync the dropdown to match what was clicked
      document.getElementById("data-filter").value = clickedDistrict;

      // Refresh both charts using the clicked district
      await triggerStatisticsRefresh(clickedDistrict);
      await triggerChangeRefresh(clickedDistrict);
      await triggerInsightsRefresh(clickedDistrict); // <-- add this
    } else if (event.selected.length === 0) {
      // Clicked empty space - deselected, revert to National view
      document.getElementById("data-filter").value = "National";
      await triggerStatisticsRefresh("National");
      await triggerChangeRefresh("National");
      await triggerInsightsRefresh("National"); // <-- add this
    }
  });
}

/**
 * Lightens a hex color based on intensity (0 = near-white, 1 = full color).
 * Used so each land-use class's choropleth shading matches its own pie-chart color.
 */
function lightenColor(hex, intensity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const blend = (channel) => Math.round(255 - (255 - channel) * intensity);

  return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
}

/**
 * Recolors the dzongkhag map layer based on how much of a given land-use
 * class each district contains — lighter color = less area, darker = more.
 */
async function showChoropleth(className) {
  const responseData = await DashboardModel.fetchClassBreakdown(className);
  if (!responseData || !responseData.breakdown) return;

  const breakdown = responseData.breakdown;
  const values = Object.values(breakdown);
  const maxValue = Math.max(...values);

  // Reconciles district-name spelling differences between the map layer
  // and the land-use data, same mapping used on the backend but in reverse
  // (map spelling -> data spelling), so we can look up each feature's value.
  const districtNameMap = {
    Mongar: "Monggar",
    "Samdrup Jongkhar": "Samdrupjongkhar",
    "Tashi Yangtse": "Trashiyangtse",
    Tashigang: "Trashigang",
    "Wangdue Phodrang": "Wangduephodrang",
  };

  dzongkhagLayer.setStyle(function (feature) {
    const mapName = feature.get("dzongkhag");
    const dataName = districtNameMap[mapName] || mapName;
    const value = breakdown[dataName] || 0;
    const intensity = maxValue > 0 ? value / maxValue : 0;

    // Use this class's own pie-chart color, lightened based on intensity
    const classColors = statsChart.data.datasets[0].backgroundColor;
    const classIndex = statsChart.data.labels.indexOf(className);
    const baseColor = classColors[classIndex] || "#228b22";
    const fillColor = lightenColor(baseColor, Math.max(intensity, 0.15));

    return new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#1d88e5", width: 1.5 }),
      fill: new ol.style.Fill({ color: fillColor }),
      text: new ol.style.Text({
        text: mapName,
        font: "bold 11px sans-serif",
        fill: new ol.style.Fill({ color: "#212529" }),
        stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
        overflow: true,
      }),
    });
  });
}

/**
 * Restores the dzongkhag map layer's default (non-choropleth) styling.
 */
function resetChoropleth() {
  dzongkhagLayer.setStyle(function (feature) {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "#1d88e5", width: 1.5 }),
      fill: new ol.style.Fill({ color: "rgba(29, 136, 229, 0.08)" }),
      text: new ol.style.Text({
        text: feature.get("dzongkhag"),
        font: "bold 11px sans-serif",
        fill: new ol.style.Fill({ color: "#212529" }),
        stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
        overflow: true,
      }),
    });
  });
}

function initDataCharts() {
  const ctx = document.getElementById("dashboardChart").getContext("2d");

  statsChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: [], // Populated dynamically by model response categories
      datasets: [
        {
          data: [], // Populated dynamically by model response values
          // Color hex palette matched exactly to your bhutan.map class specifications
          backgroundColor: [
            "#ffd700", // Agriculture Land -> COLOR 255 215 0
            "#b4e6b4", // Alpine Scrubs -> COLOR 180 230 180
            "#dc5050", // Built up -> COLOR 220 80 80
            "#228b22", // Forests -> COLOR 34 139 34
            "#b4783c", // Landslides -> COLOR 180 120 60
            "#90ee90", // Meadows -> COLOR 144 238 144
            "#a9a9a9", // Moraines -> COLOR 169 169 169
            "#d2b48c", // Non Built up -> COLOR 210 180 140
            "#808080", // Rocky Outcrops -> COLOR 128 128 128
            "#f0e68c", // Sandy Bank -> COLOR 240 230 140
            "#6b8e23", // Shrubs -> COLOR 107 142 35
            "#f0f8ff", // Snow and Glacier -> COLOR 240 248 255
            "#4682b4", // Water Bodies -> COLOR 70 130 180
          ],
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onHover: function (event, activeElements) {
        if (activeElements.length > 0) {
          const index = activeElements[0].index;
          const className = statsChart.data.labels[index];
          showChoropleth(className);
        } else {
          resetChoropleth();
        }
      },
      plugins: {
        legend: {
          position: "right",
          labels: { boxWidth: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              let label = context.label || "";
              let value = context.raw || 0;
              // Format raw numbers with thousands-separator commas
              return `${label}: ${Number(value).toLocaleString()} sq km`;
            },
          },
        },
      },
    },
  });

  document
    .getElementById("dashboardChart")
    .addEventListener("mouseleave", function () {
      resetChoropleth();
    });
}

/**
 * Initializes the "Land-Use Change" bar chart with a blank state.
 * This chart shows net area gained/lost per class between 2016 and 2020.
 */
function initChangeChart() {
  const ctx = document.getElementById("changeChart").getContext("2d");

  changeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: [], // Will hold class names (e.g. "Forests", "Agriculture Land")
      datasets: [
        {
          label: "Net Change (km²)",
          data: [], // Will hold net area change values (positive = gained, negative = lost)
          backgroundColor: [], // Set dynamically: green for gains, red for losses
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "km²" },
        },
      },
    },
  });
}

/**
 * Worker Function: Queries your local Node.js API server for chart metrics
 */
async function triggerStatisticsRefresh(regionName) {
  try {
    console.log(`[Controller] Querying Model for live data: ${regionName}`);
    const responseData = await DashboardModel.fetchRegionStats(regionName);

    if (responseData && responseData.categories && responseData.values) {
      statsChart.data.labels = responseData.categories;
      statsChart.data.datasets[0].data = responseData.values;
      statsChart.update();
      console.log(
        `[Controller] Chart successfully populated with ${responseData.categories.length} spatial classes.`,
      );
    }
  } catch (error) {
    console.error(
      "[Controller] Failed to pass database values to chart view:",
      error,
    );
  }
}

/**
 * Worker Function: Queries the change-detection API and renders both
 * the net-change bar chart and the full transition table.
 */
async function triggerChangeRefresh(regionName) {
  try {
    console.log(`[Controller] Querying Model for change data: ${regionName}`);
    const responseData = await DashboardModel.fetchRegionChange(regionName);

    if (responseData && responseData.transitions) {
      const transitions = responseData.transitions;

      // 1. Compute NET change per class: area gained minus area lost.
      // A transition row means "this much area moved FROM class_2016 TO class_2020".
      // So class_2016 loses that area, and class_2020 gains it.
      const netChangeByClass = {};

      transitions.forEach((row) => {
        const from = row.class_2016;
        const to = row.class_2020;
        const area = parseFloat(row.area_sqkm);

        if (!netChangeByClass[from]) netChangeByClass[from] = 0;
        if (!netChangeByClass[to]) netChangeByClass[to] = 0;

        netChangeByClass[from] -= area; // lost from this class
        netChangeByClass[to] += area; // gained into this class
      });

      // 2. Convert the {className: netValue} object into parallel arrays for Chart.js
      const labels = Object.keys(netChangeByClass);
      const values = labels.map((label) =>
        parseFloat(netChangeByClass[label].toFixed(2)),
      );
      // Green if the class gained area overall, red if it lost area
      const colors = values.map((v) => (v >= 0 ? "#2e8b57" : "#c0392b"));

      changeChart.data.labels = labels;
      changeChart.data.datasets[0].data = values;
      changeChart.data.datasets[0].backgroundColor = colors;
      changeChart.update();

      // 3. Populate the full transition table (only rows where class actually changed)
      const tableBody = document.getElementById("transition-table-body");
      tableBody.innerHTML = ""; // Clear any previous rows before adding new ones

      transitions
        .filter((row) => row.class_2016 !== row.class_2020)
        .forEach((row) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${row.class_2016}</td>
            <td>${row.class_2020}</td>
            <td style="text-align:right;">${row.area_sqkm}</td>
          `;
          tableBody.appendChild(tr);
        });

      console.log(
        `[Controller] Change chart populated with ${labels.length} classes.`,
      );
    }
  } catch (error) {
    console.error(
      "[Controller] Failed to process land-use change data:",
      error,
    );
  }
}

/**
 * Worker Function: Queries the AI insights endpoint and displays the
 * generated summary in the AI overview panel.
 */
async function triggerInsightsRefresh(regionName) {
  const insightsText = document.getElementById("ai-insights-text");
  insightsText.textContent = "Generating AI overview...";

  try {
    console.log(`[Controller] Querying Model for AI insights: ${regionName}`);
    const responseData = await DashboardModel.fetchDistrictInsights(regionName);

    if (responseData && responseData.summary) {
      insightsText.textContent = responseData.summary;
    } else {
      insightsText.textContent = "AI overview unavailable for this region.";
    }
  } catch (error) {
    console.error("[Controller] Failed to load AI insights:", error);
    insightsText.textContent = "AI overview unavailable for this region.";
  }
}

/**
 * WORKER FUNCTION: Swaps MapServer WMS layers on the OpenLayers map canvas
 */
function updateMapLayerOverlay(layerName) {
  console.log(`[Controller] Initializing layer request for: ${layerName}`);

  if (activeWmsOverlay) {
    olMap.removeLayer(activeWmsOverlay);
    activeWmsOverlay = null;
  }

  if (!layerName || layerName === "None") return;

  // 1. Define our spatial parameters manually
  const wmsSource = new ol.source.TileWMS({
    url: "http://localhost/cgi-bin/mapserv.exe",
    params: {
      MAP: "bhutan",
      LAYERS: layerName,
      TILED: true,
      VERSION: "1.3.0",
      CRS: "EPSG:3857",
    },
    serverType: "mapserver",
    // Define the grid explicitly so OpenLayers never sends a single large request
    tileGrid: new ol.tilegrid.TileGrid({
      resolutions: [
        156543.0339, 78271.5169, 39135.7585, 19567.8792, 9783.9396, 4891.9698,
        2445.9849, 1222.9924, 611.4962, 305.7481, 152.8741, 76.437, 38.2185,
        19.1093, 9.5546, 4.7773, 2.3887, 1.1943, 0.5972,
      ],
      origin: [-20037508.34, 20037508.34],
      tileSize: 256,
    }),
  });

  // 2. THE DIAGNOSTIC SNIPPER: Intercept tile delivery and print network statuses to console
  wmsSource.setTileLoadFunction(function (tile, src) {
    console.log(`[MapServer Link Generated]: ${src}`);

    const xhr = new XMLHttpRequest();
    xhr.open("GET", src);
    xhr.responseType = "blob";

    xhr.onload = function () {
      if (xhr.status !== 200) {
        console.error(
          `[Tile Error] HTTP Status ${xhr.status} returned from MapServer.`,
        );
      } else {
        // If it's text (like an XML error string) instead of an actual image blob
        if (
          xhr.response.type === "text/xml" ||
          xhr.response.type === "application/vnd.ogc.se_xml"
        ) {
          const reader = new FileReader();
          reader.onload = function () {
            console.error("====== MAPSERVER CORE EXCEPTION ======");
            console.error(reader.result);
            console.error("======================================");
          };
          reader.readAsText(xhr.response);
        } else {
          // It's a valid transparent image tile delivery!
          tile.getImage().src = URL.createObjectURL(xhr.response);
        }
      }
    };

    xhr.onerror = function () {
      console.error(
        "[Network Error] OpenLayers could not establish connection to mapserv.exe.",
      );
    };

    xhr.send();
  });

  // 3. Mount onto active view
  activeWmsOverlay = new ol.layer.Tile({
    source: wmsSource,
    opacity: 0.7,
  });

  olMap.addLayer(activeWmsOverlay);
}

/**
 * MODIFIED INTERCEPTOR: Includes the missing layer dropdown change event listener
 */
function bindUserActionInterceptors() {
  // Listener A: District Filter Dropdown (Updates Chart)
  document
    .getElementById("data-filter")
    .addEventListener("change", async function (event) {
      const pickedRegion = event.target.value;
      console.log("Controller caught filter action for: " + pickedRegion);

      await triggerStatisticsRefresh(pickedRegion);
      await triggerChangeRefresh(pickedRegion); // <-- NEW: also refresh change chart
      await triggerInsightsRefresh(pickedRegion);
    });

  // Listener B: Active Map Layer Dropdown (Updates Map Canvas)
  document
    .getElementById("layer-selector") // Targets the ID inside index.html exactly
    .addEventListener("change", function (event) {
      const selectedLayer = event.target.value;
      console.log("[Controller] Dropdown selected layer: " + selectedLayer);

      updateMapLayerOverlay(selectedLayer);
    });

  // Listener C: Toggle button for showing/hiding the full transition table  <-- NEW BLOCK
  document
    .getElementById("toggle-transition-table")
    .addEventListener("click", function () {
      const container = document.getElementById("transition-table-container");
      const isHidden = container.style.display === "none";
      container.style.display = isHidden ? "block" : "none";
      this.textContent = isHidden
        ? "Hide full transition table"
        : "Show full transition table";
    });
}
