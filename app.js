"use strict";

// Hàm lấy phần tử HTML bằng id
const $ = (id) => document.getElementById(id);

// Tạo icon từ các symbol trong index.html
const icon = (name) => `
  <svg aria-hidden="true">
    <use href="#i-${name}"/>
  </svg>
`;

// Hình minh họa cho các thành phố gợi ý
const CITY_ART = [
  '<svg viewBox="0 0 90 68"><rect width="90" height="68" fill="#e5e9d4"/><circle cx="72" cy="16" r="9" fill="#f8f2c6"/><path d="M0 58h90v10H0" fill="#c1d1a4"/><path d="M11 58V33h13v25M29 58V20h16v38M52 58V30h18v28M75 58V40h9v18" fill="#a3b287"/><path d="M35 20V9h4v11M39 9 43 20" fill="#738a62"/><path d="M33 29h8M33 38h8M33 47h8M56 39h10M56 48h10" stroke="#e7eacb" stroke-width="2"/></svg>',
  '<svg viewBox="0 0 90 68"><rect width="90" height="68" fill="#e4e9e3"/><circle cx="18" cy="16" r="9" fill="#f0e6c5"/><path d="M0 57h90v11H0" fill="#a4c1c2"/><path d="M8 56V34h10v22M22 56V20h15v36M42 56V29h12v27M59 56V10h14v46M77 56V37h10v19" fill="#8da3a3"/><path d="M63 10V4h6v6M26 29h7M26 38h7M63 21h6M63 29h6M63 37h6M63 45h6" stroke="#dce7db" stroke-width="2"/></svg>',
  '<svg viewBox="0 0 90 68"><rect width="90" height="68" fill="#f2e5d6"/><circle cx="69" cy="15" r="9" fill="#f7d9a0"/><path d="M0 59h90v9H0" fill="#bfc8ac"/><path d="m36 59 9-44 9 44M40 40h10M37 52h16M45 15V8" stroke="#aa917b" stroke-width="3" fill="none"/><path d="M4 59V35h20v24M62 59V31h23v28" fill="#c4b09a"/><path d="M8 42h12M8 50h12M67 39h12M67 47h12" stroke="#f4e7d4" stroke-width="2"/></svg>',
];

// Tọa độ theo thứ tự: [kinh độ, vĩ độ]
const suggestions = [
  {
    name: "Thành phố Hồ Chí Minh",
    address: "Việt Nam · Những góc phố đầy sức sống",
    coordinates: [106.7009, 10.7769],
    zoom: 14.5,
  },
  {
    name: "New York",
    address: "Hoa Kỳ · Khám phá thành phố từ trên cao",
    coordinates: [-74.0066, 40.7135],
    zoom: 15.8,
  },
  {
    name: "Paris",
    address: "Pháp · Một vòng quanh thành phố ánh sáng",
    coordinates: [2.2945, 48.8584],
    zoom: 15.6,
  },
];

// Trạng thái ứng dụng
let map;
let marker;
let userMarker;
let selected;

let is3D = false;
let currentStyle = "liberty";

let queryVersion = 0;
let searchController;
let searchTimer;
let toastTimer;
let mapWatchdog;

let saved = [];

// Đọc địa điểm đã lưu trên trình duyệt
try {
  const data = JSON.parse(localStorage.getItem("atlas-saved") || "[]");

  if (Array.isArray(data)) {
    saved = data.filter(validPlace).slice(0, 100);
  }
} catch {
  // Nếu dữ liệu lưu không hợp lệ, dùng danh sách rỗng.
}

// Kiểm tra dữ liệu địa điểm
function validPlace(place) {
  return (
    place &&
    typeof place.name === "string" &&
    Array.isArray(place.coordinates) &&
    place.coordinates.length === 2 &&
    place.coordinates.every(Number.isFinite) &&
    Math.abs(place.coordinates[0]) <= 180 &&
    Math.abs(place.coordinates[1]) <= 90
  );
}

// Hiển thị thông báo nhỏ trên bản đồ
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 5000);
}

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

// Chuyển tọa độ thành chuỗi dễ đọc
function coordinatesText(coordinates) {
  const longitude = coordinates[0];
  const latitude = coordinates[1];

  const northSouth = latitude >= 0 ? "N" : "S";
  const eastWest = longitude >= 0 ? "E" : "W";

  return (
    `${Math.abs(latitude).toFixed(5)}° ${northSouth}` +
    ` · ${Math.abs(longitude).toFixed(5)}° ${eastWest}`
  );
}

// Di chuyển camera của bản đồ
function camera(options) {
  if (!map) return;

  map.flyTo({
    ...options,
    duration: reduceMotion ? 0 : 1400,
  });
}

// Thu gọn sidebar sau khi chọn địa điểm trên điện thoại
function mobileCollapse() {
  if (window.innerWidth <= 700) {
    $("sidebar").classList.add("collapsed");
    updateMobileToggle();
  }
}

function updateMobileToggle() {
  const collapsed = $("sidebar").classList.contains("collapsed");

  $("mobile-toggle").innerHTML = icon(collapsed ? "search" : "close");

  $("mobile-toggle").setAttribute(
    "aria-label",
    collapsed ? "Mở thanh tìm kiếm" : "Thu gọn thanh tìm kiếm",
  );
}

// Chuyển nội dung của sidebar
function showPanel(panel) {
  $("explore-panel").hidden = panel !== "explore";
  $("saved-panel").hidden = panel !== "saved";
  $("results-panel").hidden = panel !== "results";

  ["explore", "saved"].forEach((name) => {
    $(`${name}-tab`).classList.toggle("active", panel === name);

    $(`${name}-tab`).setAttribute("aria-pressed", String(panel === name));
  });
}

// Hủy yêu cầu tìm kiếm cũ
function invalidateSearch() {
  clearTimeout(searchTimer);

  queryVersion++;

  searchController?.abort();
  searchController = null;
}

// Chọn địa điểm, đặt marker và di chuyển đến đó
function selectPlace(place, options = {}) {
  if (!validPlace(place)) return;

  invalidateSearch();

  selected = {
    name: place.name,
    address: place.address || "",
    coordinates: [...place.coordinates],
    zoom: place.zoom || 16,
  };

  $("detail").hidden = false;
  $("detail-title").textContent = selected.name;
  $("detail-address").textContent = selected.address;
  $("detail-coordinates").textContent = coordinatesText(selected.coordinates);

  $("map-place").textContent = selected.name;

  updateSaveButton();

  if (map) {
    marker?.remove();

    // Dùng textContent để hiển thị an toàn dữ liệu API
    const popupContent = document.createElement("div");

    const name = document.createElement("div");
    name.className = "popup-name";
    name.textContent = selected.name;

    const address = document.createElement("div");
    address.className = "popup-address";
    address.textContent = selected.address;

    popupContent.append(name, address);

    marker = new maplibregl.Marker({
      color: "#256b55",
    })
      .setLngLat(selected.coordinates)
      .setPopup(
        new maplibregl.Popup({
          offset: 28,
        }).setDOMContent(popupContent),
      )
      .addTo(map);

    camera({
      center: selected.coordinates,
      zoom: is3D ? Math.max(selected.zoom, 16) : selected.zoom,
      pitch: is3D ? 58 : 0,
      bearing: is3D ? -20 : 0,
    });
  }

  if (options.input !== false) {
    $("search").value = selected.name;
  }

  mobileCollapse();
}

// So sánh hai địa điểm bằng tọa độ
function samePlace(first, second) {
  return first.coordinates.every(
    (number, index) => Math.abs(number - second.coordinates[index]) < 0.00001,
  );
}

function updateSaveButton() {
  const exists = selected && saved.some((place) => samePlace(place, selected));

  $("save-place").querySelector("span").textContent = exists
    ? "Đã lưu · Nhấn để bỏ lưu"
    : "Lưu địa điểm";
}

// Tạo nút kết quả tìm kiếm
function resultButton(place) {
  const button = document.createElement("button");

  button.className = "result";
  button.innerHTML = icon("pin");

  const text = document.createElement("div");

  const title = document.createElement("strong");
  title.textContent = place.name;

  const subtitle = document.createElement("small");
  subtitle.textContent = place.address || coordinatesText(place.coordinates);

  text.append(title, subtitle);
  button.append(text);

  button.addEventListener("click", () => {
    selectPlace(place);
  });

  return button;
}

// Hiển thị danh sách địa điểm đã lưu
function renderSaved() {
  $("saved-count").textContent = saved.length;
  $("saved-list").replaceChildren();

  if (!saved.length) {
    const message = document.createElement("p");

    message.className = "muted";
    message.textContent =
      "Chưa có địa điểm đã lưu. " + "Tìm một địa điểm và chọn “Lưu địa điểm”.";

    $("saved-list").append(message);
  }

  saved.forEach((place) => {
    $("saved-list").append(resultButton(place));
  });
}

// Hiển thị các thành phố gợi ý
suggestions.forEach((place, index) => {
  const button = document.createElement("button");

  button.className = "place-card";

  button.innerHTML = `
    <span class="city-art" aria-hidden="true">
      ${CITY_ART[index]}
    </span>

    <span>
      <div class="place-title"></div>
      <div class="place-subtitle"></div>
    </span>

    ${icon("arrow")}
  `;

  button.querySelector(".place-title").textContent = place.name;

  button.querySelector(".place-subtitle").textContent =
    place.address.split(" · ")[0];

  button.addEventListener("click", () => {
    showPanel("explore");
    selectPlace(place);
  });

  $("suggestions").append(button);
});

renderSaved();

// Thêm lớp tòa nhà 3D
function ensureBuildings() {
  if (!map?.getStyle()?.layers) return;

  const style = map.getStyle();

  // Tắt lớp 3D mặc định để tránh hiển thị trùng
  style.layers
    .filter(
      (layer) =>
        layer.type === "fill-extrusion" && layer.id !== "atlas-buildings",
    )
    .forEach((layer) => {
      map.setLayoutProperty(layer.id, "visibility", "none");
    });

  if (!map.getSource("atlas-vector")) {
    map.addSource("atlas-vector", {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    });
  }

  if (!map.getLayer("atlas-buildings")) {
    // Đặt tòa nhà dưới lớp nhãn địa điểm
    const labels = style.layers.find(
      (layer) => layer.type === "symbol" && layer.layout?.["text-field"],
    );

    map.addLayer(
      {
        id: "atlas-buildings",
        type: "fill-extrusion",
        source: "atlas-vector",
        "source-layer": "building",
        minzoom: 14,

        filter: ["!=", ["get", "hide_3d"], true],

        layout: {
          visibility: is3D ? "visible" : "none",
        },

        paint: {
          "fill-extrusion-color":
            currentStyle === "dark" ? "#809b9c" : "#b5c9b1",

          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],

          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],

          "fill-extrusion-opacity": 0.88,
        },
      },
      labels?.id,
    );
  } else {
    map.setLayoutProperty(
      "atlas-buildings",
      "visibility",
      is3D ? "visible" : "none",
    );
  }
}

// Chuyển giữa chế độ 2D và 3D
function setView(value) {
  if (!map) {
    toast("Bản đồ chưa sẵn sàng. Hãy thử tải lại.");
    return;
  }

  is3D = value;

  ensureBuildings();

  $("view-2d").classList.toggle("active", !value);
  $("view-3d").classList.toggle("active", value);

  $("view-2d").setAttribute("aria-pressed", String(!value));

  $("view-3d").setAttribute("aria-pressed", String(value));

  $("view-label").textContent = value ? "GÓC NHÌN 3D" : "GÓC NHÌN 2D";

  camera({
    pitch: value ? 58 : 0,
    bearing: value ? -20 : 0,
    zoom: value ? Math.max(map.getZoom(), 16) : map.getZoom(),
  });

  if (value) {
    toast("Kéo chuột phải để xoay. " + "Tòa nhà 3D hiển thị ở nơi có dữ liệu.");
  }
}

function mapError() {
  clearTimeout(mapWatchdog);

  $("map-loading").hidden = true;
  $("map-error").hidden = false;
}

// Khởi tạo bản đồ thật
function initMap() {
  if (!window.maplibregl) {
    mapError();
    return;
  }

  try {
    map = new maplibregl.Map({
      container: "map",

      // Bản đồ nền từ OpenFreeMap
      style: "https://tiles.openfreemap.org/styles/liberty",

      // Vị trí ban đầu: Thành phố Hồ Chí Minh
      center: suggestions[0].coordinates,

      zoom: 14.3,
      attributionControl: true,
      maxPitch: 70,
    });

    // Hiển thị thước đo khoảng cách
    map.addControl(
      new maplibregl.ScaleControl({
        maxWidth: 90,
        unit: "metric",
      }),
      "bottom-left",
    );

    mapWatchdog = setTimeout(mapError, 22000);

    // Chạy khi kiểu bản đồ đã tải
    map.on("style.load", () => {
      clearTimeout(mapWatchdog);

      $("map-loading").hidden = true;
      $("map-error").hidden = true;

      try {
        ensureBuildings();
      } catch {
        toast(
          "Lớp tòa nhà 3D chưa tải được. " +
            "Hãy đổi kiểu bản đồ hoặc thử lại.",
        );
      }
    });

    map.on("error", (event) => {
      console.warn("Map resource error:", event.error?.message);

      if (!map.isStyleLoaded()) {
        mapError();
      } else {
        toast(
          "Một phần dữ liệu bản đồ chưa tải được. " + "Kiểm tra kết nối mạng.",
        );
      }
    });

    // Cập nhật tọa độ và hướng la bàn
    map.on("move", () => {
      $("center-coordinates").textContent = coordinatesText(
        map.getCenter().toArray(),
      );

      $("compass-icon").style.transform = `rotate(${-map.getBearing()}deg)`;
    });

    // Chọn một địa điểm có nhãn trên bản đồ
    map.on("click", (event) => {
      const features = map
        .queryRenderedFeatures(event.point)
        .filter(
          (feature) =>
            feature.geometry.type === "Point" &&
            (feature.properties?.name || feature.properties?.["name:en"]),
        );

      const place = features[0];

      if (place) {
        selectPlace({
          name: place.properties.name || place.properties["name:en"],

          address: "Địa điểm trên bản đồ · OpenStreetMap",

          coordinates: place.geometry.coordinates.slice(0, 2),

          zoom: Math.max(16, map.getZoom()),
        });
      }
    });
  } catch (error) {
    console.warn("Map initialization:", error.message);

    map = undefined;
    mapError();
  }
}

initMap();

// Chuyển dữ liệu từ API Photon sang dữ liệu website
function photonPlace(feature) {
  const properties = feature.properties || {};

  const name =
    properties.name ||
    [properties.housenumber, properties.street].filter(Boolean).join(" ") ||
    properties.city ||
    properties.country ||
    "Địa điểm";

  const address = [
    properties.housenumber && properties.street
      ? `${properties.housenumber} ${properties.street}`
      : properties.street,

    properties.district,
    properties.city,
    properties.state,
    properties.country,
  ]
    .filter(
      (value, index, array) =>
        value && value !== name && array.indexOf(value) === index,
    )
    .join(", ");

  const wide = ["city", "town", "village", "state", "country"].includes(
    properties.osm_value,
  );

  return {
    name,
    address,
    coordinates: feature.geometry?.coordinates,
    zoom: wide ? 12.5 : 16,
  };
}

// Gọi API tìm địa điểm
async function searchPlaces(autoSelect = false) {
  clearTimeout(searchTimer);
  searchController?.abort();

  const version = ++queryVersion;
  const query = $("search").value.trim();

  if (query.length < 2) {
    $("search-status").textContent = "Nhập ít nhất 2 ký tự để tìm địa điểm.";

    $("results").replaceChildren();

    if (query) {
      showPanel("results");
    } else {
      showPanel("explore");
    }

    return;
  }

  showPanel("results");

  $("results").replaceChildren();
  $("search-status").textContent = "Đang tìm địa điểm…";

  const controller = new AbortController();
  searchController = controller;

  // Hủy nếu API phản hồi quá chậm
  const timeout = setTimeout(() => {
    controller.abort();
  }, 12000);

  try {
    const params = new URLSearchParams({
      q: query,
      limit: "6",
      lang: "en",
    });

    const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Bỏ qua kết quả của từ khóa cũ
    if (version !== queryVersion) return;

    if (!Array.isArray(data.features)) {
      throw new Error("Invalid geocoder response");
    }

    const places = data.features.map(photonPlace).filter(validPlace);

    $("search-status").textContent = places.length
      ? `${places.length} kết quả · Chọn một nơi để đến đó`
      : "Không tìm thấy địa điểm. " + "Thử tên đầy đủ hoặc thêm tên thành phố.";

    places.forEach((place) => {
      $("results").append(resultButton(place));
    });

    // Nhấn Enter: tự đến kết quả đầu tiên
    if (autoSelect && places.length) {
      selectPlace(places[0], {
        input: false,
      });

      $("results").firstElementChild?.classList.add("active");
    }
  } catch (error) {
    if (version !== queryVersion) return;

    $("search-status").textContent =
      error.name === "AbortError"
        ? "Tìm kiếm mất quá nhiều thời gian. " + "Nhấn Enter để thử lại."
        : "Không thể kết nối dịch vụ tìm kiếm. " +
          "Kiểm tra mạng và nhấn Enter để thử lại.";
  } finally {
    clearTimeout(timeout);

    if (searchController === controller) {
      searchController = null;
    }
  }
}

// Gợi ý kết quả khi người dùng đang nhập
$("search").addEventListener("input", () => {
  invalidateSearch();

  if (!$("search").value.trim()) {
    showPanel("explore");
    return;
  }

  showPanel("results");

  $("results").replaceChildren();
  $("search-status").textContent = "Tiếp tục nhập để tìm địa điểm…";

  // Chờ người dùng ngừng gõ 650 ms rồi mới gọi API
  searchTimer = setTimeout(() => {
    searchPlaces(false);
  }, 650);
});

// Người dùng nhấn Enter hoặc nút tìm kiếm
$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  searchPlaces(true);
});

// Điều khiển kết quả bằng bàn phím
$("search").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    invalidateSearch();
    showPanel("explore");
    $("search").blur();
  }

  if (event.key === "ArrowDown") {
    $("results").querySelector("button")?.focus();
    event.preventDefault();
  }
});

$("results").addEventListener("keydown", (event) => {
  const buttons = [...$("results").querySelectorAll("button")];

  const index = buttons.indexOf(document.activeElement);

  if (event.key === "ArrowDown") {
    buttons[(index + 1) % buttons.length]?.focus();
    event.preventDefault();
  }

  if (event.key === "ArrowUp") {
    if (index <= 0) {
      $("search").focus();
    } else {
      buttons[index - 1].focus();
    }

    event.preventDefault();
  }
});

// Các nút của sidebar
$("close-results").onclick = () => {
  invalidateSearch();
  showPanel("explore");
};

$("explore-tab").onclick = () => {
  invalidateSearch();
  showPanel("explore");
};

$("saved-tab").onclick = () => {
  invalidateSearch();
  renderSaved();
  showPanel("saved");
};

$("close-detail").onclick = () => {
  $("detail").hidden = true;

  marker?.remove();
  marker = undefined;
  selected = undefined;
};

// Lưu hoặc bỏ lưu địa điểm
$("save-place").onclick = () => {
  if (!selected) return;

  const prior = saved;

  const exists = saved.some((place) => {
    return samePlace(place, selected);
  });

  saved = exists
    ? saved.filter((place) => !samePlace(place, selected))
    : [selected, ...saved].slice(0, 100);

  try {
    localStorage.setItem("atlas-saved", JSON.stringify(saved));

    updateSaveButton();
    renderSaved();

    toast(
      exists ? "Đã bỏ lưu địa điểm." : "Đã lưu địa điểm trên trình duyệt này.",
    );
  } catch {
    saved = prior;
    toast("Trình duyệt không cho phép lưu địa điểm.");
  }
};

// Các nút 2D/3D
$("view-2d").onclick = () => {
  setView(false);
};

$("view-3d").onclick = () => {
  setView(true);
};

$("try-3d").onclick = () => {
  setView(true);
  mobileCollapse();
};

// Phóng to, thu nhỏ và quay về hướng Bắc
$("zoom-in").onclick = () => {
  map?.zoomIn({
    duration: reduceMotion ? 0 : 300,
  });
};

$("zoom-out").onclick = () => {
  map?.zoomOut({
    duration: reduceMotion ? 0 : 300,
  });
};

$("compass").onclick = () => {
  map?.easeTo({
    bearing: 0,
    duration: reduceMotion ? 0 : 400,
  });
};

// Mở/đóng menu kiểu bản đồ
$("layers-toggle").onclick = () => {
  const open = $("layers-menu").hidden;

  $("layers-menu").hidden = !open;

  $("layers-toggle").setAttribute("aria-expanded", String(open));
};

document.addEventListener("click", (event) => {
  if (!event.target.closest(".layers-control")) {
    $("layers-menu").hidden = true;

    $("layers-toggle").setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("layers-menu").hidden = true;

    $("layers-toggle").setAttribute("aria-expanded", "false");
  }
});

// Chuyển bản đồ đường phố, tối giản hoặc ban đêm
document.querySelectorAll("[data-style]").forEach((button) => {
  button.onclick = () => {
    if (!map) return;

    currentStyle = button.dataset.style;

    document.querySelectorAll("[data-style]").forEach((item) => {
      item.classList.toggle("active", item === button);

      item.setAttribute("aria-pressed", String(item === button));
    });

    $("map-loading").hidden = false;
    mapWatchdog = setTimeout(mapError, 22000);

    map.setStyle(`https://tiles.openfreemap.org/styles/${currentStyle}`);

    $("layers-menu").hidden = true;

    $("layers-toggle").setAttribute("aria-expanded", "false");
  };
});

// Định vị người dùng
function locate() {
  if (!map) {
    toast("Bản đồ chưa sẵn sàng. Hãy thử tải lại.");
    return;
  }

  if (!navigator.geolocation) {
    toast("Trình duyệt này không hỗ trợ định vị.");
    return;
  }

  const buttons = [$("locate-sidebar"), $("locate-map")];

  buttons.forEach((button) => {
    button.disabled = true;
  });

  toast("Đang xác định vị trí của bạn…");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      buttons.forEach((button) => {
        button.disabled = false;
      });

      const coordinates = [position.coords.longitude, position.coords.latitude];

      userMarker?.remove();

      userMarker = new maplibregl.Marker({
        color: "#4285f4",
      })
        .setLngLat(coordinates)
        .addTo(map);

      selectPlace({
        name: "Vị trí của bạn",

        address:
          "Vị trí ước tính · Độ chính xác khoảng " +
          `${Math.round(position.coords.accuracy)} m`,

        coordinates,
        zoom: 16,
      });

      toast("Đã chuyển đến vị trí của bạn.");
    },

    (error) => {
      buttons.forEach((button) => {
        button.disabled = false;
      });

      let message;

      if (error.code === 1) {
        message =
          "Bạn chưa cho phép định vị. " +
          "Bật quyền vị trí cho website trong trình duyệt.";
      } else if (error.code === 3) {
        message = "Định vị mất quá nhiều thời gian. Hãy thử lại.";
      } else {
        message =
          "Không thể xác định vị trí. " +
          "Thử tìm địa chỉ bằng thanh tìm kiếm.";
      }

      toast(message);
    },

    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    },
  );
}

$("locate-sidebar").onclick = locate;
$("locate-map").onclick = locate;

$("retry-map").onclick = () => {
  location.reload();
};

// Mở/đóng sidebar trên điện thoại
$("mobile-toggle").onclick = () => {
  $("sidebar").classList.toggle("collapsed");

  updateMobileToggle();

  if (!$("sidebar").classList.contains("collapsed")) {
    $("search").focus();
  }
};

updateMobileToggle();
