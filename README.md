# Bhutan Land-Use Analytics Dashboard

An interactive PostGIS-backed dashboard for exploring land-use distribution across Bhutan's dzongkhags (districts).

## Overview

Built with a Node/Express + PostGIS backend and an OpenLayers + Chart.js frontend, this dashboard lets users filter land-use statistics by district and view live-computed area breakdowns across 13 land-use classes (forest, agriculture, built-up, snow and glacier, etc.), alongside WMS map layers served via MapServer.

## Stack

| Layer            | Tools                  |
| ---------------- | ---------------------- |
| Spatial database | PostgreSQL + PostGIS   |
| Backend          | Node.js, Express, `pg` |
| Map serving      | MapServer (WMS)        |
| Frontend mapping | OpenLayers             |
| Visualisation    | Chart.js               |

## Project structure

```
App/
├── api/
│   └── server.js        # Express API, PostGIS queries
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── model.js      # data fetching
│       └── controller.js # map/chart state, DOM events
├── .env.example           # required environment variables (copy to .env)
└── package.json
```

## Setup

1. Clone the repo and install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your own PostgreSQL/PostGIS credentials:
   ```
   cp .env.example .env
   ```
3. Ensure a PostGIS-enabled PostgreSQL database is running locally, with a `bhutan.landuse` table containing `class_name`, `dzongkhag`, and `area_sqkm` columns.
4. Start the API server:
   ```
   npm run server
   ```
5. In a separate terminal, start the frontend:
   ```
   npm start
   ```
6. Visit `http://localhost:3000`.

MapServer (via MS4W or equivalent) must also be running and configured to serve the WMS layers referenced by `bhutan.map` for the map layer toggles to work.

## API

`GET /api/v1/statistics/:regionName`

Returns aggregated land-use area by class for a given district, or for `National` / `All Districts (National)` to get the country-wide breakdown.

```json
{
  "status": "success",
  "region": "Thimphu",
  "categories": ["Forest", "Agriculture", "Built-up", "..."],
  "values": [1234.56, 78.9, 45.2]
}
```

## Status / Roadmap

This project currently provides a single-snapshot spatial view. Planned extension: multi-temporal land-use change detection (comparing land-use layers across two time periods using `ST_Intersection`, with a district-level transition matrix) to add a genuine temporal dimension to the analysis.

## Author

Built by Jigme Namgay as part of a geospatial portfolio.
