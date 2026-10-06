"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Search,
  Map as MapIcon,
  Bookmark,
  LocateFixed,
  ArrowRight,
  Box,
  X,
  Layers,
  Compass,
  Plus,
  Minus,
  Check,
  Navigation,
  Trash2,
  Pencil,
  RefreshCw
} from "lucide-react";

import {
  validPlace,
  samePlace,
  coordinatesText,
  distanceMeters
} from "./geo.mjs";

const CITIES = [
  {
    name: "Thành phố Hồ Chí Minh",
    address: "Việt Nam · Những góc phố đầy sức sống",
    coordinates: [106.7009, 10.7769],
    zoom: 14.5,
    color: "#e5e9d4",
    ink: "#9aaa84"
  },
  {
    name: "New York",
    address: "Hoa Kỳ · Khám phá thành phố từ trên cao",
    coordinates: [-74.0066, 40.7135],
    zoom: 15.8,
    color: "#e4e9e3",
    ink: "#8da3a3"
  },
  {
    name: "Paris",
    address: "Pháp · Một vòng quanh thành phố ánh sáng",
    coordinates: [2.2945, 48.8584],
    zoom: 15.6,
    color: "#f2e5d6",
    ink: "#b59e86"
  }
];

async function api(
  path,
  { method = "GET", body, signal } = {}
) {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: body
      ? { "Content-Type": "application/json" }
      : { Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Chưa nhận được phản hồi từ máy chủ. Hãy thử lại."
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error || "Yêu cầu chưa thành công."
    );
  }

  return data;
}

function browserSaved() {
  try {
    const value = JSON.parse(
      localStorage.getItem("atlas-saved") || "[]"
    );

    return Array.isArray(value)
      ? value
          .filter(validPlace)
          .map(place => ({
            ...place,
            id: place.id || crypto.randomUUID(),
            note: place.note || ""
          }))
          .slice(0, 500)
      : [];
  } catch {
    return [];
  }
}

function CityArt({ city, index }) {
  return (
    <svg viewBox="0 0 90 68" aria-hidden="true">
      <rect
        width="90"
        height="68"
        fill={city.color}
      />
      <circle
        cx="72"
        cy="16"
        r="9"
        fill="#f8ecc8"
      />

      {index === 2 ? (
        <path
          d="m36 59 9-44 9 44M40 40h10M37 52h16M45 15V8"
          stroke={city.ink}
          strokeWidth="3"
          fill="none"
        />
      ) : (
        <g fill={city.ink}>
          <path d="M10 59V33h14v26M29 59V20h15v39M51 59V29h17v30M73 59V40h10v19" />
          <path d="M34 20V8h5v12" />
        </g>
      )}

      <path
        d="M0 59h90v9H0"
        fill={index === 1 ? "#b4cbcb" : "#c2ccad"}
      />
    </svg>
  );
}

export default function AtlasApp() {
  const container = useRef(null);
  const mapRef = useRef(null);
  const library = useRef(null);
  const markerRef = useRef(null);
  const userMarker = useRef(null);
  const chooseRef = useRef(null);

  const modeRef = useRef(false);
  const styleRef = useRef("liberty");
  const searchRef = useRef(null);
  const requestRef = useRef(null);
  const queryVersion = useRef(0);
  const timerRef = useRef(null);
  const toastTimer = useRef(null);
  const mapTimer = useRef(null);

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [view3D, setView3D] = useState(false);
  const [style, setStyle] = useState("liberty");
  const [layersOpen, setLayersOpen] = useState(false);

  const [panel, setPanel] = useState("explore");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState("");
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");

  const [saved, setSaved] = useState([]);
  const [storage, setStorage] = useState("loading");
  const [session, setSession] = useState(null);
  const [savedError, setSavedError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const [collapsed, setCollapsed] = useState(false);
  const [message, setMessage] = useState("");
  const [center, setCenter] = useState(
    CITIES[0].coordinates
  );
  const [bearing, setBearing] = useState(0);
  const [placeLabel, setPlaceLabel] = useState(
    CITIES[0].name
  );

  const [radius, setRadius] = useState(3000);
  const [nearby, setNearby] = useState(null);
  const [nearbyBusy, setNearbyBusy] = useState(false);

  const reduced = () =>
    typeof window !== "undefined" &&
    window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

  function toast(text) {
    setMessage(text);
    clearTimeout(toastTimer.current);

    toastTimer.current = setTimeout(
      () => setMessage(""),
      5000
    );
  }

  function invalidate() {
    clearTimeout(timerRef.current);
    queryVersion.current++;
    requestRef.current?.abort();
    requestRef.current = null;
  }

  function ensureBuildings(map) {
    const current = map.getStyle();

    if (!current?.layers) {
      return;
    }

    current.layers
      .filter(
        layer =>
          layer.type === "fill-extrusion" &&
          layer.id !== "atlas-buildings"
      )
      .forEach(layer => {
        map.setLayoutProperty(
          layer.id,
          "visibility",
          "none"
        );
      });

    const vector = Object.keys(current.sources).find(
      id => current.sources[id].type === "vector"
    );

    const source = vector || "atlas-vector";

    if (!vector && !map.getSource(source)) {
      map.addSource(source, {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet"
      });
    }

    if (!map.getLayer("atlas-buildings")) {
      const labels = current.layers.find(
        layer =>
          layer.type === "symbol" &&
          layer.layout?.["text-field"]
      );

      map.addLayer(
        {
          id: "atlas-buildings",
          type: "fill-extrusion",
          source,
          "source-layer": "building",
          minzoom: 14,
          filter: ["!=", ["get", "hide_3d"], true],
          layout: {
            visibility: modeRef.current
              ? "visible"
              : "none"
          },
          paint: {
            "fill-extrusion-color":
              styleRef.current === "dark"
                ? "#809b9c"
                : "#b5c9b1",
            "fill-extrusion-height": [
              "coalesce",
              ["get", "render_height"],
              6
            ],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "render_min_height"],
              0
            ],
            "fill-extrusion-opacity": 0.88
          }
        },
        labels?.id
      );
    } else {
      map.setLayoutProperty(
        "atlas-buildings",
        "visibility",
        modeRef.current ? "visible" : "none"
      );
    }
  }

  useEffect(() => {
    let stopped = false;
    let map;

    (async () => {
      try {
        const module = await import("maplibre-gl");

        if (stopped) {
          return;
        }

        const lib = module.default || module;
        library.current = lib;

        map = new lib.Map({
          container: container.current,
          style:
            "https://tiles.openfreemap.org/styles/liberty",
          center: CITIES[0].coordinates,
          zoom: 14.3,
          maxPitch: 70,
          attributionControl: true
        });

        mapRef.current = map;

        map.addControl(
          new lib.ScaleControl({
            maxWidth: 90,
            unit: "metric"
          }),
          "bottom-left"
        );

        mapTimer.current = setTimeout(
          () => setMapError(true),
          22000
        );

        map.on("style.load", () => {
          if (stopped) {
            return;
          }

          clearTimeout(mapTimer.current);
          setMapError(false);
          setReady(true);

          try {
            ensureBuildings(map);
          } catch {
            toast(
              "Lớp tòa nhà 3D chưa tải được. Hãy đổi kiểu bản đồ hoặc thử lại."
            );
          }
        });

        map.on("moveend", () => {
          if (!stopped) {
            setCenter(map.getCenter().toArray());
          }
        });

        map.on("rotate", () => {
          if (!stopped) {
            setBearing(map.getBearing());
          }
        });

        map.on("click", event => {
          const poi = map
            .queryRenderedFeatures(event.point)
            .find(
              feature =>
                feature.geometry.type === "Point" &&
                (
                  feature.properties?.name ||
                  feature.properties?.["name:en"]
                )
            );

          if (poi) {
            chooseRef.current?.({
              name:
                poi.properties.name ||
                poi.properties["name:en"],
              address:
                "Địa điểm trên bản đồ · OpenStreetMap",
              coordinates:
                poi.geometry.coordinates.slice(0, 2),
              zoom: Math.max(16, map.getZoom())
            });
          }
        });

        map.on("error", () => {
          if (!stopped && !map.isStyleLoaded()) {
            setMapError(true);
          }
        });
      } catch {
        if (!stopped) {
          setMapError(true);
        }
      }
    })();

    return () => {
      stopped = true;

      clearTimeout(mapTimer.current);
      clearTimeout(timerRef.current);
      clearTimeout(toastTimer.current);

      requestRef.current?.abort();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    let stopped = false;

    (async () => {
      try {
        const data = await api("/session");

        if (stopped) {
          return;
        }

        setSession(data.user);
        setStorage(data.storage);

        if (data.storage === "account") {
          if (!data.user) {
            setSavedError(
              "Đăng nhập để truy cập các địa điểm đã lưu."
            );
            return;
          }

          const items = await api("/places");

          if (!stopped) {
            setSaved(items.places);
          }
        } else {
          setSaved(browserSaved());
        }
      } catch (error) {
        if (!stopped) {
          setSavedError(error.message);
          setStorage("unavailable");
        }
      }
    })();

    return () => {
      stopped = true;
    };
  }, []);

  function choose(place) {
    if (!validPlace(place)) {
      return;
    }

    invalidate();

    setSelected(place);

    setNote(
      saved.find(item => samePlace(item, place))?.note ||
      place.note ||
      ""
    );

    setQuery(place.name);
    setPlaceLabel(place.name);

    const map = mapRef.current;
    const lib = library.current;

    if (map && lib) {
      markerRef.current?.remove();

      const content = document.createElement("div");
      const name = document.createElement("div");

      name.className = "popup-name";
      name.textContent = place.name;

      const address = document.createElement("div");

      address.className = "popup-address";
      address.textContent = place.address || "";

      content.append(name, address);

      markerRef.current = new lib.Marker({
        color: "#256b55"
      })
        .setLngLat(place.coordinates)
        .setPopup(
          new lib.Popup({ offset: 28 })
            .setDOMContent(content)
        )
        .addTo(map);

      map.flyTo({
        center: place.coordinates,
        zoom: modeRef.current
          ? Math.max(place.zoom || 16, 16)
          : place.zoom || 16,
        pitch: modeRef.current ? 58 : 0,
        bearing: modeRef.current ? -20 : 0,
        duration: reduced() ? 0 : 1400
      });
    }

    if (window.innerWidth <= 700) {
      setCollapsed(true);
    }
  }

  chooseRef.current = choose;

  useEffect(() => {
    const close = event => {
      if (!event.target.closest(".layers-control")) {
        setLayersOpen(false);
      }
    };

    const escape = event => {
      if (event.key === "Escape") {
        setLayersOpen(false);
      }
    };

    document.addEventListener("click", close);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  async function search(
    autoSelect = false,
    text = query
  ) {
    invalidate();

    const version = queryVersion.current;
    const term = text.trim();

    setPanel("results");
    setResults([]);

    if (term.length < 2) {
      setSearchStatus(
        "Nhập ít nhất 2 ký tự để tìm địa điểm."
      );
      return;
    }

    setSearchStatus("Đang tìm địa điểm…");

    const controller = new AbortController();
    requestRef.current = controller;

    const timeout = setTimeout(
      () => controller.abort(),
      12000
    );

    try {
      const data = await api(
        `/search?q=${encodeURIComponent(term)}`,
        { signal: controller.signal }
      );

      if (version !== queryVersion.current) {
        return;
      }

      const places = data.places.filter(validPlace);

      setResults(places);

      setSearchStatus(
        places.length
          ? `${places.length} kết quả · Chọn một nơi để đến đó`
          : "Không tìm thấy địa điểm. Thử thêm tên thành phố."
      );

      if (autoSelect && places.length) {
        choose(places[0]);
      }
    } catch (error) {
      if (version === queryVersion.current) {
        setSearchStatus(
          error.name === "AbortError"
            ? "Tìm kiếm mất quá nhiều thời gian. Nhấn Enter để thử lại."
            : error.message
        );
      }
    } finally {
      clearTimeout(timeout);

      if (requestRef.current === controller) {
        requestRef.current = null;
      }
    }
  }

  function changeQuery(value) {
    setQuery(value);
    invalidate();
    setResults([]);

    if (!value.trim()) {
      setPanel("explore");
      return;
    }

    setPanel("results");
    setSearchStatus(
      "Tiếp tục nhập để tìm địa điểm…"
    );

    timerRef.current = setTimeout(
      () => search(false, value),
      650
    );
  }

  function switchPanel(value) {
    invalidate();
    setPanel(value);
    setNearby(null);
  }

  function changeView(value) {
    const map = mapRef.current;

    if (!map || !ready) {
      return;
    }

    modeRef.current = value;
    setView3D(value);
    ensureBuildings(map);

    map.flyTo({
      pitch: value ? 58 : 0,
      bearing: value ? -20 : 0,
      zoom: value
        ? Math.max(map.getZoom(), 16)
        : map.getZoom(),
      duration: reduced() ? 0 : 1000
    });

    if (value) {
      toast(
        "Kéo chuột phải để xoay. Tòa nhà 3D hiển thị ở nơi có dữ liệu."
      );
    }
  }

  function changeStyle(value) {
    if (!mapRef.current) {
      return;
    }

    styleRef.current = value;

    setStyle(value);
    setLayersOpen(false);
    setReady(false);
    setMapError(false);

    clearTimeout(mapTimer.current);

    mapTimer.current = setTimeout(
      () => setMapError(true),
      22000
    );

    mapRef.current.setStyle(
      `https://tiles.openfreemap.org/styles/${value}`
    );
  }

  async function reloadSaved() {
    try {
      setSavedError("");

      if (storage === "account") {
        const data = await api("/places");
        setSaved(data.places);
      } else if (storage === "browser") {
        setSaved(browserSaved());
      }
    } catch (error) {
      setSavedError(error.message);
    }
  }

  function persistBrowser(items) {
    localStorage.setItem(
      "atlas-saved",
      JSON.stringify(items)
    );

    setSaved(items);
  }

  const selectedSaved = selected
    ? saved.find(place => samePlace(place, selected))
    : null;

  const canSave =
    storage === "browser" ||
    (
      storage === "account" &&
      session &&
      !savedError
    );

  async function toggleSave() {
    if (!selected || !canSave || busy) {
      return;
    }

    setBusy(true);

    try {
      if (selectedSaved) {
        if (storage === "account") {
          await api(
            `/places/${selectedSaved.id}`,
            { method: "DELETE" }
          );

          setSaved(
            saved.filter(
              place => place.id !== selectedSaved.id
            )
          );
        } else {
          persistBrowser(
            saved.filter(
              place => place.id !== selectedSaved.id
            )
          );
        }

        toast("Đã bỏ lưu địa điểm.");
      } else {
        const payload = {
          name: selected.name,
          address: selected.address || "",
          coordinates: selected.coordinates,
          note
        };

        if (storage === "account") {
          const data = await api("/places", {
            method: "POST",
            body: payload
          });

          setSaved([data.place, ...saved]);
        } else {
          persistBrowser(
            [
              {
                ...payload,
                id: crypto.randomUUID(),
                zoom: selected.zoom || 16
              },
              ...saved
            ].slice(0, 500)
          );
        }

        toast(
          storage === "account"
            ? "Đã lưu địa điểm."
            : "Đã lưu trên trình duyệt này."
        );
      }

      setNearby(null);
    } catch (error) {
      toast(
        error.message ||
        "Trình duyệt không cho phép lưu địa điểm."
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!selectedSaved || busy) {
      return;
    }

    setBusy(true);

    try {
      let updated = {
        ...selectedSaved,
        note
      };

      if (storage === "account") {
        updated = (
          await api(
            `/places/${selectedSaved.id}`,
            {
              method: "PATCH",
              body: { note }
            }
          )
        ).place;
      }

      const items = saved.map(place =>
        place.id === updated.id ? updated : place
      );

      if (storage === "browser") {
        persistBrowser(items);
      } else {
        setSaved(items);
      }

      setNearby(null);
      toast("Đã cập nhật ghi chú.");
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function findNearby() {
    if (!ready || nearbyBusy) {
      return;
    }

    setNearbyBusy(true);

    const point = mapRef.current
      .getCenter()
      .toArray();

    try {
      let places;

      if (storage === "account") {
        places = (
          await api(
            `/places/nearby?lon=${point[0]}` +
            `&lat=${point[1]}&radius=${radius}`
          )
        ).places;
      } else {
        places = saved
          .map(place => ({
            ...place,
            distanceMeters: distanceMeters(
              point,
              place.coordinates
            )
          }))
          .filter(
            place => place.distanceMeters <= radius
          )
          .sort(
            (a, b) =>
              a.distanceMeters - b.distanceMeters
          );
      }

      setNearby(places);

      toast(
        `${places.length} địa điểm đã lưu trong bán kính ${
          radius / 1000
        } km.`
      );
    } catch (error) {
      toast(error.message);
    } finally {
      setNearbyBusy(false);
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      toast(
        "Trình duyệt này không hỗ trợ định vị."
      );
      return;
    }

    if (!ready) {
      return;
    }

    setLocating(true);
    toast("Đang xác định vị trí của bạn…");

    navigator.geolocation.getCurrentPosition(
      position => {
        setLocating(false);

        const coordinates = [
          position.coords.longitude,
          position.coords.latitude
        ];

        userMarker.current?.remove();

        userMarker.current =
          new library.current.Marker({
            color: "#4285f4"
          })
            .setLngLat(coordinates)
            .addTo(mapRef.current);

        choose({
          name: "Vị trí của bạn",
          address:
            "Vị trí ước tính · Độ chính xác khoảng " +
            `${Math.round(position.coords.accuracy)} m`,
          coordinates,
          zoom: 16
        });

        toast(
          "Đã chuyển đến vị trí của bạn."
        );
      },
      error => {
        setLocating(false);

        toast(
          error.code === 1
            ? "Bạn chưa cho phép định vị. Bật quyền vị trí cho website trong trình duyệt."
            : "Không thể xác định vị trí. Hãy thử tìm địa chỉ."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000
      }
    );
  }

  function resultCard(place, showDistance = false) {
    return (
      <button
        className={
          "result" +
          (samePlace(selected, place) ? " active" : "")
        }
        key={
          place.id ||
          `${place.name}-${place.coordinates.join(",")}`
        }
        onClick={() => choose(place)}
      >
        <Navigation size={17} />

        <span>
          <strong>{place.name}</strong>

          <small>
            {place.address ||
              coordinatesText(place.coordinates)}
          </small>

          {showDistance && (
            <small className="distance-label">
              {place.distanceMeters < 1000
                ? `${Math.round(place.distanceMeters)} m`
                : `${(
                    place.distanceMeters / 1000
                  ).toFixed(1)} km`}
              {" "}từ tâm bản đồ
            </small>
          )}

          {place.note && (
            <small className="note-preview">
              {place.note}
            </small>
          )}
        </span>

        <ArrowRight
          className="result-arrow"
          size={14}
        />
      </button>
    );
  }

  const savedItems =
    nearby === null ? saved : nearby;

  return (
    <div className="atlas-app">
      <nav
        className="rail"
        aria-label="Điều hướng chính"
      >
        <a
          href="/"
          className="brand"
          aria-label="Atlas, trang chủ"
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M16 5 3 28h8l5-12 5 12h8Z"
              fill="currentColor"
            />
          </svg>
        </a>

        <button
          className={
            "rail-item" +
            (panel === "explore" ? " active" : "")
          }
          aria-pressed={panel === "explore"}
          onClick={() => switchPanel("explore")}
        >
          <MapIcon />
          <span>Khám phá</span>
        </button>

        <button
          className={
            "rail-item" +
            (panel === "saved" ? " active" : "")
          }
          aria-pressed={panel === "saved"}
          onClick={() => switchPanel("saved")}
        >
          <Bookmark />
          <span>Đã lưu</span>

          {saved.length > 0 && (
            <span className="rail-count">
              {saved.length}
            </span>
          )}
        </button>

        <div className="rail-bottom">
          <span className="avatar">
            {session?.name?.charAt(0).toUpperCase() || "H"}
          </span>
          <span>Atlas Maps</span>
        </div>
      </nav>

      <aside
        className={
          "sidebar" + (collapsed ? " collapsed" : "")
        }
      >
        <header className="sidebar-header">
          <div className="wordmark">
            atlas
            <span className="wordmark-dot">.</span>
          </div>

          <span className="eyebrow">
            THẾ GIỚI TRONG TẦM TAY
          </span>
        </header>

        <form
          className="search-box"
          role="search"
          onSubmit={event => {
            event.preventDefault();
            search(true);
          }}
        >
          <Search />

          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={event =>
              changeQuery(event.target.value)
            }
            onKeyDown={event => {
              if (event.key === "Escape") {
                switchPanel("explore");
              }
            }}
            placeholder="Tìm địa điểm, thành phố…"
            aria-label="Tìm địa điểm"
            autoComplete="off"
            maxLength={150}
          />

          <button
            type="submit"
            className="search-submit"
            aria-label="Tìm kiếm"
          >
            <ArrowRight />
          </button>
        </form>

        <div className="search-hint">
          Nhập địa điểm rồi nhấn Enter để đến đó.
        </div>

        <div className="mobile-tabs">
          <button
            className={
              panel === "explore" ? "active" : ""
            }
            onClick={() => switchPanel("explore")}
          >
            Khám phá
          </button>

          <button
            className={
              panel === "saved" ? "active" : ""
            }
            onClick={() => switchPanel("saved")}
          >
            Đã lưu ({saved.length})
          </button>
        </div>

        {panel === "results" && (
          <section aria-label="Kết quả tìm kiếm">
            <div className="section-top">
              <h2>Kết quả tìm kiếm</h2>

              <button
                className="text-button"
                onClick={() => switchPanel("explore")}
              >
                Đóng
              </button>
            </div>

            <p className="muted" role="status">
              {searchStatus}
            </p>

            <div>
              {results.map(place => resultCard(place))}
            </div>
          </section>
        )}

        {panel === "explore" && (
          <>
            <div className="intro">
              <span className="little-label">
                ĐI MỘT CHÚT, THẤY NHIỀU HƠN
              </span>

              <h1>
                Đi đến nơi
                <br />
                bạn muốn<span>.</span>
              </h1>

              <p>
                Một góc phố quen, một thành phố mới.
                <br />
                Hành trình bắt đầu từ đây.
              </p>
            </div>

            <button
              className="locate-row"
              disabled={!ready || locating}
              onClick={locate}
            >
              <span className="round-icon">
                <LocateFixed />
              </span>

              <span>
                <strong>Khám phá quanh bạn</strong>
                <small>Sử dụng vị trí hiện tại</small>
              </span>

              <ArrowRight className="arrow" />
            </button>

            <div className="section-top">
              <h2>Một nơi để bắt đầu</h2>
              <span className="small-tag">GỢI Ý</span>
            </div>

            <div className="places">
              {CITIES.map((city, index) => (
                <button
                  className="place-card"
                  key={city.name}
                  onClick={() => choose(city)}
                >
                  <span className="city-art">
                    <CityArt
                      city={city}
                      index={index}
                    />
                  </span>

                  <span>
                    <span className="place-title">
                      {city.name}
                    </span>

                    <span className="place-subtitle">
                      {city.address.split(" · ")[0]}
                    </span>
                  </span>

                  <ArrowRight className="arrow" />
                </button>
              ))}
            </div>

            <div className="tip-card">
              <Box />

              <div>
                <strong>
                  Đổi góc nhìn. Thấy điều mới.
                </strong>

                <p>
                  Chuyển sang 3D để khám phá các khối
                  tòa nhà. Phóng gần để xem rõ hơn.
                </p>

                <button
                  disabled={!ready}
                  onClick={() => {
                    changeView(true);

                    if (window.innerWidth <= 700) {
                      setCollapsed(true);
                    }
                  }}
                >
                  Thử chế độ 3D <span>↗</span>
                </button>
              </div>
            </div>
          </>
        )}

        {panel === "saved" && (
          <section aria-label="Địa điểm đã lưu">
            <div className="section-top">
              <h2>Địa điểm đã lưu</h2>
              <span className="small-tag">
                {saved.length}
              </span>
            </div>

            <p className="muted">
              {storage === "account"
                ? session?.scope === "device"
                  ? "Lưu trong kho địa điểm của thiết bị này."
                  : "Những nơi bạn muốn quay lại, lưu theo tài khoản."
                : "Địa điểm đang được lưu trên trình duyệt này."}
            </p>

            {savedError && (
              <div
                className="storage-notice"
                role="alert"
              >
                {savedError}

                <button onClick={reloadSaved}>
                  <RefreshCw size={12} />
                  Thử lại
                </button>
              </div>
            )}

            {storage === "account" && !session && (
              <a
                className="sign-in"
                href="/signin-with-chatgpt?return_to=/"
                target="_top"
              >
                Đăng nhập
              </a>
            )}

            <div className="nearby-control">
              <label htmlFor="radius">
                Tìm địa điểm đã lưu quanh tâm bản đồ
              </label>

              <div>
                <select
                  id="radius"
                  value={radius}
                  onChange={event => {
                    setRadius(
                      Number(event.target.value)
                    );
                    setNearby(null);
                  }}
                >
                  <option value={1000}>1 km</option>
                  <option value={3000}>3 km</option>
                  <option value={5000}>5 km</option>
                  <option value={10000}>10 km</option>
                </select>

                <button
                  onClick={findNearby}
                  disabled={
                    !ready ||
                    nearbyBusy ||
                    !canSave
                  }
                >
                  <LocateFixed size={14} />
                  {nearbyBusy
                    ? "Đang tìm…"
                    : "Tìm quanh đây"}
                </button>
              </div>
            </div>

            {nearby !== null && (
              <div className="section-top filter-summary">
                <span>
                  {nearby.length} địa điểm trong{" "}
                  {radius / 1000} km
                </span>

                <button
                  className="text-button"
                  onClick={() => setNearby(null)}
                >
                  Xem tất cả
                </button>
              </div>
            )}

            {savedItems.length ? (
              savedItems.map(place =>
                resultCard(place, nearby !== null)
              )
            ) : (
              <div className="empty-state">
                <Bookmark />

                <strong>
                  {nearby !== null
                    ? "Chưa có địa điểm trong khu vực này"
                    : "Giữ lại những nơi bạn thích"}
                </strong>

                <p>
                  {nearby !== null
                    ? "Thử bán kính lớn hơn hoặc di chuyển bản đồ."
                    : "Tìm một địa điểm và chọn “Lưu địa điểm” để bắt đầu."}
                </p>
              </div>
            )}
          </section>
        )}

        {selected && (
          <section
            className="detail"
            aria-label="Địa điểm đang chọn"
          >
            <div className="section-top">
              <span className="little-label">
                ĐỊA ĐIỂM ĐANG CHỌN
              </span>

              <button
                className="icon-button"
                aria-label="Đóng thông tin"
                onClick={() => {
                  setSelected(null);
                  markerRef.current?.remove();
                }}
              >
                <X />
              </button>
            </div>

            <h2>{selected.name}</h2>
            <p>{selected.address}</p>

            <div className="coordinate-line">
              {coordinatesText(selected.coordinates)}
            </div>

            <label
              className="note-label"
              htmlFor="place-note"
            >
              <Pencil size={12} />
              Ghi chú của bạn
            </label>

            <textarea
              id="place-note"
              value={note}
              onChange={event =>
                setNote(event.target.value)
              }
              maxLength={1000}
              placeholder="Một quán cà phê muốn ghé, một nơi muốn trở lại…"
              rows={3}
            />

            <button
              className="save-button"
              onClick={toggleSave}
              disabled={busy || !canSave}
            >
              {selectedSaved
                ? <Trash2 />
                : <Bookmark />}

              <span>
                {busy
                  ? "Đang lưu…"
                  : selectedSaved
                    ? "Bỏ lưu địa điểm"
                    : "Lưu địa điểm"}
              </span>
            </button>

            {selectedSaved &&
              note !== selectedSaved.note && (
                <button
                  className="update-note"
                  onClick={saveNote}
                  disabled={busy || !canSave}
                >
                  Lưu ghi chú
                </button>
              )}

            <small className="storage-label">
              {storage === "loading"
                ? "Đang mở kho địa điểm…"
                : storage === "account"
                  ? "Lưu trong kho địa điểm của bạn."
                  : storage === "browser"
                    ? "Lưu trên trình duyệt này."
                    : "Chưa kết nối được kho lưu địa điểm."}
            </small>
          </section>
        )}

        <footer className="sidebar-footer">
          <span className="online-dot" />
          Bản đồ mở. Khám phá không giới hạn.
        </footer>
      </aside>

      <main
        className="map-stage"
        aria-label="Bản đồ tương tác"
      >
        <div id="map" ref={container} />

        <button
          className="mobile-panel-toggle"
          aria-label={
            collapsed
              ? "Mở thanh tìm kiếm"
              : "Thu gọn thanh tìm kiếm"
          }
          onClick={() => {
            setCollapsed(!collapsed);

            if (collapsed) {
              setTimeout(
                () => searchRef.current?.focus(),
                0
              );
            }
          }}
        >
          {collapsed ? <Search /> : <X />}
        </button>

        <div className="map-top">
          <div className="location-pill">
            <span className="online-dot" />
            <span>{placeLabel}</span>
          </div>

          <div
            className="view-switch"
            role="group"
            aria-label="Chế độ bản đồ"
          >
            <button
              className={!view3D ? "active" : ""}
              aria-pressed={!view3D}
              disabled={!ready}
              onClick={() => changeView(false)}
            >
              <MapIcon />
              2D
            </button>

            <button
              className={view3D ? "active" : ""}
              aria-pressed={view3D}
              disabled={!ready}
              onClick={() => changeView(true)}
            >
              <Box />
              3D
            </button>
          </div>
        </div>

        {!ready && !mapError && (
          <div className="map-message" role="status">
            <span className="spinner" />
            Đang mở bản đồ thế giới…
          </div>
        )}

        {mapError && (
          <div
            className="map-message map-error"
            role="alert"
          >
            <strong>Chưa thể tải bản đồ</strong>

            <p>
              Kiểm tra kết nối mạng và thử lại.
              Trình duyệt cần hỗ trợ WebGL.
            </p>

            <button
              onClick={() => window.location.reload()}
            >
              Tải lại bản đồ
            </button>
          </div>
        )}

        <div className="map-tools">
          <button
            className="map-tool"
            title="Hướng Bắc"
            aria-label="Quay bản đồ về hướng Bắc"
            disabled={!ready}
            onClick={() =>
              mapRef.current?.easeTo({
                bearing: 0,
                duration: reduced() ? 0 : 400
              })
            }
          >
            <Compass
              style={{
                transform: `rotate(${-bearing}deg)`
              }}
            />
            <small>N</small>
          </button>

          <div className="zoom-group">
            <button
              className="map-tool"
              aria-label="Phóng to"
              disabled={!ready}
              onClick={() =>
                mapRef.current?.zoomIn()
              }
            >
              <Plus />
            </button>

            <button
              className="map-tool"
              aria-label="Thu nhỏ"
              disabled={!ready}
              onClick={() =>
                mapRef.current?.zoomOut()
              }
            >
              <Minus />
            </button>
          </div>

          <button
            className="map-tool"
            aria-label="Đến vị trí của tôi"
            disabled={!ready || locating}
            onClick={locate}
          >
            <LocateFixed />
          </button>
        </div>

        <div className="map-bottom">
          <div className="layers-control">
            <button
              className="layers-button"
              aria-expanded={layersOpen}
              aria-controls="layers-menu"
              onClick={() =>
                setLayersOpen(!layersOpen)
              }
            >
              <span className="layers-art">
                <Layers />
              </span>
              <span>Kiểu bản đồ</span>
            </button>

            {layersOpen && (
              <div
                id="layers-menu"
                className="layers-menu"
              >
                <span className="little-label">
                  CHỌN KIỂU BẢN ĐỒ
                </span>

                {[
                  ["liberty", "Đường phố", "streets"],
                  ["positron", "Tối giản", "light"],
                  ["dark", "Ban đêm", "dark"]
                ].map(([value, label, preview]) => (
                  <button
                    key={value}
                    className={
                      style === value ? "active" : ""
                    }
                    aria-pressed={style === value}
                    onClick={() =>
                      changeStyle(value)
                    }
                  >
                    <span
                      className={
                        "style-preview " + preview
                      }
                    />

                    {label}

                    <Check
                      className="check"
                      size={14}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="map-readout">
            <span>
              GÓC NHÌN {view3D ? "3D" : "2D"}
            </span>

            <span>
              {coordinatesText(center)}
            </span>
          </div>
        </div>

        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </main>
    </div>
  );
}