// Landing page: send the big screen to /host and phones to /play with their room code.

const hostBtn = document.getElementById("hostBtn");
const joinForm = document.getElementById("joinForm");
const codeInput = document.getElementById("code");
const error = document.getElementById("error");

hostBtn.addEventListener("click", () => {
  location.href = "/host";
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, "");
  error.textContent = "";
});

joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = codeInput.value.trim();
  if (code.length !== 4) {
    error.textContent = "Enter the 4-letter code from the big screen.";
    return;
  }
  location.href = `/play?room=${code}`;
});

// Meet the cars: one card per car type, built from shared/cars.json.

const STAT_LABELS = { topSpeed: "Top speed", acceleration: "Acceleration", handling: "Handling", weight: "Weight" };

function carCard(type, car, colors) {
  const card = document.createElement("article");
  card.className = "car-card";

  const stage = document.createElement("div");
  stage.className = "car-stage";
  const main = document.createElement("img");
  stage.append(main);

  const swatches = document.createElement("div");
  swatches.className = "swatches";
  const buttons = colors.map((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `${car.name} in ${color}`);
    const thumb = document.createElement("img");
    thumb.src = `/cars/${type}_${color}.png`;
    thumb.alt = "";
    button.append(thumb);
    button.addEventListener("click", () => show(color));
    swatches.append(button);
    return button;
  });

  function show(color) {
    main.src = `/cars/${type}_${color}.png`;
    main.alt = `${car.name} in ${color}`;
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(colors[i] === color)));
  }

  const name = document.createElement("h3");
  name.textContent = car.name;
  const nick = document.createElement("p");
  nick.className = "nick";
  nick.textContent = car.title;

  const bars = document.createElement("dl");
  bars.className = "bars";
  for (const [key, label] of Object.entries(STAT_LABELS)) {
    const value = car.stats[key];
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.className = "pips";
    dd.setAttribute("aria-label", `${value} out of 5`);
    for (let i = 1; i <= 5; i++) {
      const pip = document.createElement("i");
      if (i <= value) pip.className = "on";
      dd.append(pip);
    }
    bars.append(dt, dd);
  }

  const pro = document.createElement("p");
  pro.className = "pro";
  pro.innerHTML = "<b>+ </b>";
  pro.append(car.strength);
  const con = document.createElement("p");
  con.className = "con";
  con.innerHTML = "<b>− </b>";
  con.append(car.weakness);

  card.append(stage, swatches, name, nick, bars, pro, con);
  show(colors[0]);
  return card;
}

fetch("/shared/cars.json")
  .then((response) => response.json())
  .then(({ types, colors }) => {
    const grid = document.getElementById("carGrid");
    for (const [type, car] of Object.entries(types)) grid.append(carCard(type, car, colors));
  })
  .catch(() => {
    document.getElementById("carGrid").textContent = "Couldn't load the cars.";
  });

// Tabs: show the page named in the URL hash (#home, #cars, #about, #team).

const pages = [...document.querySelectorAll(".page")];
const tabLinks = [...document.querySelectorAll(".tabs a")];

function showPage() {
  const wanted = location.hash.slice(1);
  const name = pages.some((p) => p.dataset.page === wanted) ? wanted : "home";
  pages.forEach((p) => (p.hidden = p.dataset.page !== name));
  tabLinks.forEach((a) => {
    if (a.hash === `#${name}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

window.addEventListener("hashchange", () => {
  showPage();
  scrollTo(0, 0);
});
showPage();
