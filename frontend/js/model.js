/**
 * MVC MODEL COMPONENT
 */

// Run against the live Node/PostGIS API when served locally; anywhere else
// (e.g. GitHub Pages) read the pre-exported JSON snapshot in ./data instead.
// Add ?static=1 to a local URL to preview the static demo.
const IS_STATIC_MODE =
  !["localhost", "127.0.0.1"].includes(window.location.hostname) ||
  new URLSearchParams(window.location.search).has("static");

const DashboardModel = {
  isStaticMode: IS_STATIC_MODE,

  // API Server Configuration pointing to your Node backend
  apiBaseUrl: "http://127.0.0.1:5000/api/v1",

  // Folder holding the static snapshot written by `npm run export-static`
  staticDataBaseUrl: "data",

  // MapServer Configuration pointing to your Apache CGI installation gateway
  // (the MAP=bhutan parameter is added by the controller's WMS source)
  mapServerWmsEndpoint: "http://localhost/cgi-bin/mapserv.exe",

  // The land-use data is static, so each class breakdown only needs fetching once
  classBreakdownCache: {},

  /**
   * Turns a region or class name into the file name used by the static
   * snapshot, e.g. "Samdrup Jongkhar" -> "samdrup-jongkhar".
   * Must match slugify() in scripts/export-static-data.js.
   */
  slugify: function (name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  },

  /**
   * Builds the URL for an endpoint, e.g. ("statistics", "Thimphu"), pointing
   * either at the live API or at the matching static JSON file.
   */
  endpointUrl: function (endpoint, name) {
    if (this.isStaticMode) {
      return `${this.staticDataBaseUrl}/${endpoint}/${this.slugify(name)}.json`;
    }
    return `${this.apiBaseUrl}/${endpoint}/${encodeURIComponent(name)}`;
  },

  /**
   * Fetches JSON from an endpoint, returning null (and logging) on failure
   */
  fetchJson: async function (endpoint, name, description) {
    try {
      const response = await fetch(this.endpointUrl(endpoint, name));
      if (!response.ok)
        throw new Error(`Network problem detected. Status: ${response.status}`);

      return await response.json();
    } catch (error) {
      console.error(`Model failed to retrieve ${description}:`, error);
      return null;
    }
  },

  /**
   * Fetches aggregated 2020 land-use area by class for a district or "National"
   */
  fetchRegionStats: function (regionName) {
    // Returns {status, region, categories, values}
    return this.fetchJson("statistics", regionName, "spatial statistics");
  },

  /**
   * Fetches the land-use transition matrix (2016 vs 2020) for a given district
   */
  fetchRegionChange: function (regionName) {
    // Returns {status, region, transitions}
    return this.fetchJson("change", regionName, "land-use change data");
  },

  /**
   * Fetches how much area of a given land-use class exists in each district
   */
  fetchClassBreakdown: async function (className) {
    if (this.classBreakdownCache[className]) {
      return this.classBreakdownCache[className];
    }

    // Returns {status, class_name, breakdown}
    const jsonResponse = await this.fetchJson(
      "class-breakdown",
      className,
      "class breakdown",
    );
    if (jsonResponse) this.classBreakdownCache[className] = jsonResponse;
    return jsonResponse;
  },

  /**
   * Fetches an AI-generated summary of a district's land-use profile
   */
  fetchDistrictInsights: function (regionName) {
    // Returns {status, region, summary}
    return this.fetchJson("insights", regionName, "AI district insights");
  },

  /**
   * URL of a boundary layer ("dzongkhag" or "gewog") as GeoJSON
   */
  geojsonUrl: function (layerName) {
    return this.endpointUrl("geojson", layerName);
  },
};
