# Bhutan Land-Use Analytics Dashboard

An interactive PostGIS-backed dashboard for exploring land-use distribution, and land-use change between 2016 and 2020, across Bhutan's dzongkhags (districts), using the National Land Commission Secretariat's LULC 2016 and LULC 2020 datasets.

**▶ Live demo: https://jimme09.github.io/bhutan-landuse-dashboard/**

The live demo is a static snapshot. The same frontend reads pre-exported JSON files (see [Static demo](#static-demo)) instead of calling the API, so it runs on GitHub Pages without a server. Everything works except the MapServer LULC 2020 overlay, which needs the local setup.

## Overview

Built with a Node/Express + PostGIS backend and an OpenLayers + Chart.js frontend, this dashboard lets users:

- filter land-use statistics by district (dropdown or by clicking the map) and view live-computed area breakdowns across 13 land-use classes (forest, agriculture, built-up, snow and glacier, etc.)
- hover a class in the doughnut chart to shade every district by that class's area (choropleth)
- see net gain/loss per class between 2016 and 2020, plus the full class-to-class transition table
- read a short AI-generated overview of the selected district (Groq LLM API, grounded in the district's statistics)
- toggle gewog boundaries and the LULC 2020 WMS layer served via MapServer

## Stack

| Layer            | Tools                  |
| ---------------- | ---------------------- |
| Spatial database | PostgreSQL + PostGIS   |
| Backend          | Node.js, Express, `pg` |
| Map serving      | MapServer (WMS)        |
| Frontend mapping | OpenLayers             |
| Visualisation    | Chart.js               |
| AI summaries     | Groq API (`gpt-oss-20b`) |

## Project structure

```
App/
├── api/
│   └── server.js        # Express API, PostGIS queries
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   ├── data/             # static JSON snapshot used by the live demo
│   └── js/
│       ├── model.js      # data fetching (live API or static snapshot)
│       └── controller.js # map/chart state, DOM events
├── scripts/
│   └── export-static-data.js # writes frontend/data from the running API
├── index.html             # GitHub Pages entry, redirects to frontend/
├── .env.example           # required environment variables (copy to .env)
└── package.json
```

## Setup

1. Clone the repo and install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your own PostgreSQL/PostGIS credentials and a `GROQ_API_KEY`:
   ```
   cp .env.example .env
   ```
3. Ensure a PostGIS-enabled PostgreSQL database is running locally with these tables in the `bhutan` schema (shapefiles loaded with `shp2pgsql -I -s 5266:4326`, i.e. DrukRef03 → WGS84):

   | Table                  | Source / key columns                                                 |
   | ---------------------- | -------------------------------------------------------------------- |
   | `landuse_2020`         | LULC2020.shp — `class_name`, `dzongkhag`, `gewog_name`, `area_sqkm`  |
   | `landuse_2016`         | LULC2016.shp — `class`, `dzgname`, `geogname`, `areasqm`             |
   | `dzongkhag`            | dzongkhag.shp — `dzongkhag`                                          |
   | `gewog`                | gewog.shp — `name_eng`                                               |
   | `district_transitions` | derived — `dzongkhag`, `class_2016`, `class_2020`, `area_sqkm`       |
   | `national_transitions` | derived — `class_2016`, `class_2020`, `area_sqkm`                    |

   The two transition tables are built by overlaying the 2016 and 2020 layers (`ST_Intersection`) and summing the intersected area per class pair in km² (the national total is ≈ 38,750 km², matching Bhutan's area). Because the geometries are stored in EPSG:4326, area must be measured with `ST_Area(geom::geography)` or after `ST_Transform(geom, 5266)` — plain `ST_Area(geom)` would return square degrees.
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

| Endpoint                                | Returns                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `GET /api/v1/statistics/:regionName`    | 2020 area (km²) per class for a district or `National`          |
| `GET /api/v1/change/:regionName`        | 2016 → 2020 transition rows for a district or `National`        |
| `GET /api/v1/class-breakdown/:className`| Area of one class in every district (drives the choropleth)     |
| `GET /api/v1/insights/:regionName`      | AI-generated 2–3 sentence land-use summary (cached per region)  |
| `GET /api/v1/geojson/dzongkhag`         | Dzongkhag boundaries as GeoJSON                                 |
| `GET /api/v1/geojson/gewog`             | Gewog boundaries as GeoJSON                                     |

Example — `GET /api/v1/statistics/Thimphu`:

```json
{
  "status": "success",
  "region": "Thimphu",
  "categories": ["Forest", "Agriculture", "Built-up", "..."],
  "values": [1234.56, 78.9, 45.2]
}
```

## Static demo

When the frontend is served from anywhere other than `localhost`, `model.js` reads JSON files from `frontend/data/` instead of calling the API. To preview this mode locally, open `http://localhost:3000/?static=1`.

To regenerate the snapshot (for example after changing the database or the AI prompt):

```
npm run server          # terminal 1
npm run export-static   # terminal 2
```

This saves every response the dashboard can request: the boundaries, statistics and change data for each dropdown region, the breakdown for each class, and the AI summaries. Commit the updated `frontend/data/` folder to publish it.

## Notes on interpreting change

The 2016 and 2020 maps were produced separately, so part of the detected "change" reflects differences in mapping method and class definitions rather than real change on the ground — for example, `Sandy Bank` exists only in the 2020 classification. Treat the transition figures as indicative, especially for small classes.

## Author

Built by Jigme Namgay as part of a geospatial portfolio.
