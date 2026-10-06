/**
 * MVC CONTROLLER COMPONENT
 * global variables
 */
let olMap;
let activeWmsOverlay; // Tracks the current active MapServer WMS layer
let statsChart;
let changeChart; // Tracks the land-use change (2016-2020) bar chart instance
let dzongkhagLayer; // Tracks the clickable dzongkhag boundary layer, needed for choropleth recoloring
let gewogLayer; // Tracks the labeled gewog boundary layer
let latestRegionRequest = 0; // Increments per region change so slow, outdated responses are ignored
let activeChoroplethClass = null; // Class currently shaded on the map, so repeated hovers don't refetch

// Colors matched to the bhutan.map class specifications, keyed by class name
// so a district missing some classes doesn't shift every color after it.
const CLASS_COLORS = {
  "Agriculture Land": "#ffd700", // COLOR 255 215 0
  "Alpine Scrubs": "#b4e6b4", // COLOR 180 230 180
  "Built up": "#dc5050", // COLOR 220 80 80
  Forests: "#228b22", // COLOR 34 139 34
  Landslides: "#b4783c", // COLOR 180 120 60
  Meadows: "#90ee90", // COLOR 144 238 144
  Moraines: "#a9a9a9", // COLOR 169 169 169
  "Non Built up": "#d2b48c", // COLOR 210 180 140
  "Rocky Outcrops": "#808080", // COLOR 128 128 128
  "Sandy Bank": "#f0e68c", // COLOR 240 230 140
  Shrubs: "#6b8e23", // COLOR 107 142 35
  "Snow and Glacier": "#f0f8ff", // COLOR 240 248 255
  "Water Bodies": "#4682b4", // COLOR 70 130 180
};
const FALLBACK_CLASS_COLOR = "#999999";

function colorForClass(className) {
  return CLASS_COLORS[className] || FALLBACK_CLASS_COLOR;
}

document.addEventListener("DOMContentLoaded", async function () {
  if (DashboardModel.isStaticMode) disableServerOnlyLayers();
  initSpatialMap();

  // 1. Initialize the chart instances with a blank state
  initDataCharts();
  initChangeChart();
  bindUserActionInterceptors();

  // 2. Automatically request National metrics on dashboard startup
  await refreshRegion("National");
});

/**
 * Refreshes every panel (pie chart, change chart, AI overview) for one region.
 * The three requests run in parallel; if the user picks another region before
 * they finish, the outdated results are discarded.
 */
async function refreshRegion(regionName) {
  const requestId = ++latestRegionRequest;
  const isCurrent = () => requestId === latestRegionRequest;

  await Promise.all([
    triggerStatisticsRefresh(regionName, isCurrent),
    triggerChangeRefresh(regionName, isCurrent),
    triggerInsightsRefresh(regionName, isCurrent),
  ]);
}

function setBackendStatus(isConnected) {
  const statusEl = document.getElementById("backend-status");
  if (DashboardModel.isStaticMode) {
    statusEl.textContent = isConnected
      ? "Static demo — data exported from PostGIS (run locally for the live API)"
      : "Could not load the static data files";
  } else {
    statusEl.textContent = isConnected
      ? "Live PostGIS connection active"
      : "Cannot reach the API server — is `npm run server` running?";
  }
  statusEl.style.color = isConnected ? "#2e8b57" : "#c0392b";
}

/**
 * The LULC 2020 overlay is rendered by a local MapServer, which isn't
 * available in the static demo, so its dropdown option is disabled there.
 */
function disableServerOnlyLayers() {
  const option = document.querySelector(
    '#layer-selector option[value="landuse_2020"]',
  );
  if (option) {
    option.disabled = true;
    option.textContent += " (local version only)";
  }
}

function initSpatialMap() {
  const bhutanCoordinates = ol.proj.fromLonLat([90.4, 27.51]);

  // 1. Define the plain basemap (OpenStreetMap, desaturated via the
  // .basemap-layer CSS rule so the data layers stand out)
  const plainBasemap = new ol.layer.Tile({
    source: new ol.source.OSM(),
    className: "basemap-layer",
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
    url: DashboardModel.geojsonUrl("dzongkhag"),
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

      await refreshRegion(clickedDistrict);
    } else if (event.selected.length === 0) {
      // Clicked empty space - deselected, revert to National view
      document.getElementById("data-filter").value = "National";
      await refreshRegion("National");
    }
  });

  // 6. Load gewog boundaries as a labeled GeoJSON vector layer (hidden by default)
  const gewogSource = new ol.source.Vector({
    url: DashboardModel.geojsonUrl("gewog"),
    format: new ol.format.GeoJSON(),
  });

  gewogLayer = new ol.layer.Vector({
    source: gewogSource,
    visible: false, // only shown when "Gewog Boundaries" is picked from the layer dropdown
    style: function (feature) {
      return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: "#8e44ad", width: 1 }),
        fill: new ol.style.Fill({ color: "rgba(142, 68, 173, 0.05)" }),
        text: new ol.style.Text({
          text: feature.get("gewog"),
          font: "9px sans-serif",
          fill: new ol.style.Fill({ color: "#212529" }),
          stroke: new ol.style.Stroke({ color: "#ffffff", width: 2 }),
          overflow: false, // gewogs are small, so don't force labels wider than the shape
        }),
      });
    },
  });
  olMap.addLayer(gewogLayer);
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
  if (className === activeChoroplethClass) return;
  activeChoroplethClass = className;

  const responseData = await DashboardModel.fetchClassBreakdown(className);
  // The user may have hovered another slice (or left the chart) while this loaded
  if (activeChoroplethClass !== className) return;
  if (!responseData || !responseData.breakdown) return;

  // The backend returns breakdown keys in the boundary layer's spelling,
  // so each map feature can look up its value directly by name.
  const breakdown = responseData.breakdown;
  const values = Object.values(breakdown);
  const maxValue = Math.max(...values);
  const baseColor = colorForClass(className);

  dzongkhagLayer.setStyle(function (feature) {
    const mapName = feature.get("dzongkhag");
    const value = breakdown[mapName] || 0;
    const intensity = maxValue > 0 ? value / maxValue : 0;

    // Use this class's own pie-chart color, lightened based on intensity
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
  if (activeChoroplethClass === null) return;
  activeChoroplethClass = null;

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
          backgroundColor: [], // Set per class from CLASS_COLORS on each refresh
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
async function triggerStatisticsRefresh(regionName, isCurrent = () => true) {
  try {
    console.log(`[Controller] Querying Model for live data: ${regionName}`);
    const responseData = await DashboardModel.fetchRegionStats(regionName);
    if (!isCurrent()) return;

    setBackendStatus(responseData !== null);

    if (responseData && responseData.categories && responseData.values) {
      statsChart.data.labels = responseData.categories;
      statsChart.data.datasets[0].data = responseData.values;
      statsChart.data.datasets[0].backgroundColor =
        responseData.categories.map(colorForClass);
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
async function triggerChangeRefresh(regionName, isCurrent = () => true) {
  try {
    console.log(`[Controller] Querying Model for change data: ${regionName}`);
    const responseData = await DashboardModel.fetchRegionChange(regionName);
    if (!isCurrent()) return;

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
          const cells = [
            row.class_2016,
            row.class_2020,
            parseFloat(row.area_sqkm).toFixed(2),
          ];
          cells.forEach((text, i) => {
            const td = document.createElement("td");
            td.textContent = text;
            if (i === 2) td.style.textAlign = "right";
            tr.appendChild(td);
          });
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
async function triggerInsightsRefresh(regionName, isCurrent = () => true) {
  const insightsText = document.getElementById("ai-insights-text");
  insightsText.textContent = "Generating AI overview...";

  try {
    console.log(`[Controller] Querying Model for AI insights: ${regionName}`);
    const responseData = await DashboardModel.fetchDistrictInsights(regionName);
    if (!isCurrent()) return;

    if (responseData && responseData.summary) {
      insightsText.textContent = responseData.summary;
    } else {
      insightsText.textContent = "AI overview unavailable for this region.";
    }
  } catch (error) {
    console.error("[Controller] Failed to load AI insights:", error);
    if (isCurrent()) {
      insightsText.textContent = "AI overview unavailable for this region.";
    }
  }
}

/**
 * WORKER FUNCTION: Swaps MapServer WMS layers on the OpenLayers map canvas
 */
function updateMapLayerOverlay(layerName) {
  console.log(`[Controller] Initializing layer request for: ${layerName}`);

  // Toggle the gewog vector layer's visibility based on dropdown selection
  gewogLayer.setVisible(layerName === "gewog");

  if (activeWmsOverlay) {
    olMap.removeLayer(activeWmsOverlay);
    activeWmsOverlay = null;
  }

  // Gewogs are drawn by the vector layer above, so they need no WMS overlay
  if (!layerName || layerName === "None" || layerName === "gewog") return;

  // 1. Define our spatial parameters manually
  const wmsSource = new ol.source.TileWMS({
    url: DashboardModel.mapServerWmsEndpoint,
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

  // 2. Diagnostic tile loader: surfaces MapServer errors in the console
  // instead of silently showing blank tiles
  wmsSource.setTileLoadFunction(function (tile, src) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", src);
    xhr.responseType = "blob";

    xhr.onload = function () {
      if (xhr.status !== 200) {
        console.error(
          `[Tile Error] HTTP Status ${xhr.status} returned from MapServer.`,
        );
        tile.setState(ol.TileState.ERROR);
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
          tile.setState(ol.TileState.ERROR);
        } else {
          // It's a valid image tile; free the blob URL once the image has decoded
          const image = tile.getImage();
          const objectUrl = URL.createObjectURL(xhr.response);
          image.onload = image.onerror = () => URL.revokeObjectURL(objectUrl);
          image.src = objectUrl;
        }
      }
    };

    xhr.onerror = function () {
      console.error(
        "[Network Error] OpenLayers could not establish connection to mapserv.exe.",
      );
      tile.setState(ol.TileState.ERROR);
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
 * Binds the dropdowns and the transition-table toggle to their handlers
 */
function bindUserActionInterceptors() {
  // Listener A: District Filter Dropdown (Updates all panels)
  document
    .getElementById("data-filter")
    .addEventListener("change", async function (event) {
      const pickedRegion = event.target.value;
      console.log("Controller caught filter action for: " + pickedRegion);

      await refreshRegion(pickedRegion);
    });

  // Listener B: Active Map Layer Dropdown (Updates Map Canvas)
  document
    .getElementById("layer-selector")
    .addEventListener("change", function (event) {
      const selectedLayer = event.target.value;
      console.log("[Controller] Dropdown selected layer: " + selectedLayer);

      updateMapLayerOverlay(selectedLayer);
    });

  // Listener C: Toggle button for showing/hiding the full transition table
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
