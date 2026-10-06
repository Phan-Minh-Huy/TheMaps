import React from "react";
import { createRoot } from "react-dom/client";

import AtlasApp from "../components/AtlasApp.jsx";
import "../app/globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

createRoot(document.getElementById("root")).render(
  <AtlasApp />
);