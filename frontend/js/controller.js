/**
 * MVC CONTROLLER COMPONENT
 */
let olMap;
let activeWmsOverlay; // Tracks the current active MapServer WMS layer
let statsChart;

document.addEventListener("DOMContentLoaded", async function () {
  initSpatialMap();

  // 1. Initialize the chart instance with a blank state
  initDataCharts();

  // 2. Automatically request National metrics on dashboard startup
  await triggerStatisticsRefresh("National");

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
      plugins: {
        legend: {
          position: "bottom",
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
    });

  // Listener B: Active Map Layer Dropdown (Updates Map Canvas)
  document
    .getElementById("layer-selector") // Targets the ID inside index.html exactly
    .addEventListener("change", function (event) {
      const selectedLayer = event.target.value;
      console.log("[Controller] Dropdown selected layer: " + selectedLayer);

      updateMapLayerOverlay(selectedLayer);
    });
}
