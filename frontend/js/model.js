/**
 * MVC MODEL COMPONENT
 */
const DashboardModel = {
  // API Server Configuration pointing to your Node backend
  apiBaseUrl: "http://127.0.0.1:5000/api/v1",

  // MapServer Configuration pointing to your Apache CGI installation gateway
  mapServerWmsEndpoint: "http://localhost/cgi-bin/mapserv.exe?map=bhutan",

  /**
   * Fetches data properties asynchronously from the local Node application context
   */
  fetchRegionStats: async function (regionName) {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/statistics/${encodeURIComponent(regionName)}`,
      );
      if (!response.ok)
        throw new Error(`Network problem detected. Status: ${response.status}`);

      const jsonResponse = await response.json();
      return jsonResponse; // Returns full structured entity: {status, region, categories, values}
    } catch (error) {
      console.error("Model failed to retrieve spatial statistics:", error);
      return null;
    }
  },

  /**
   * Fetches the land-use transition matrix (2016 vs 2020) for a given district
   * from the /api/v1/change/:regionName endpoint.
   */
  fetchRegionChange: async function (regionName) {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/change/${encodeURIComponent(regionName)}`,
      );
      if (!response.ok)
        throw new Error(`Network problem detected. Status: ${response.status}`);

      const jsonResponse = await response.json();
      return jsonResponse; // Returns full structured entity: {status, region, transitions}
    } catch (error) {
      console.error("Model failed to retrieve land-use change data:", error);
      return null;
    }
  },
};
