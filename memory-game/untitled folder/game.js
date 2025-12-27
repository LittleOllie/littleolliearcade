const board = document.getElementById("gameBoard");
const statusEl = document.getElementById("status");

// 18 available pairs
const ALL_PAIRS = Array.from({ length: 18 }, (_, i) => `assets/pair${i + 1}.png`);

let firstCard = null;
let secondCard = null;
let lock = false;
let matches = 0;
let totalPairs = 0;

// ---------------- START GAME ----------------
function startGame(level) {
  board.innerHTML = "";
  statusEl.textContent = "";
  firstCard = null;
  secondCard = null;
  lock = false;
  matches = 0;

  let pairCount;
  let columns;

  if (level === "easy") {
    pairCount = 8;
    columns = 4;
  } else if (level === "medium") {
    pairCount = 12;
    columns = 6;
  } else {
    pairCount = 18;
    columns = 6;
  }

  totalPairs = pairCount;

  board.style.gridTemplateColumns = `repeat(${columns}, 100px)`;

  // Choose random pairs
  const selected = shuffle([...ALL_PAIRS]).slice(0, pairCount);

  // Duplicate + shuffle
  const cards = shuffle([...selected, ...selected]);

  cards.forEach(img => createCard(img));
}

// ---------------- CREATE CARD ----------------
function createCard(img) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.img = img;

  const front = document.createElement("div");
  front.className = "front";

  const back = document.createElement("div");
  back.className = "back";
  back.style.backgroundImage = `url(${img})`;

  card.appendChild(front);
  card.appendChild(back);

  card.addEventListener("click", () => flip(card));
  board.appendChild(card);
}

// ---------------- FLIP LOGIC ----------------
function flip(card) {
  if (lock || card === firstCard || card.classList.contains("matched")) return;

  card.classList.add("flipped");

  if (!firstCard) {
    firstCard = card;
    return;
  }

  secondCard = card;
  lock = true;

  if (firstCard.dataset.img === secondCard.dataset.img) {
    firstCard.classList.add("matched");
    secondCard.classList.add("matched");
    matches++;
    resetTurn();

    if (matches === totalPairs) {
      statusEl.textContent = "🎉 You matched them all!";
    }
  } else {
    setTimeout(() => {
      firstCard.classList.remove("flipped");
      secondCard.classList.remove("flipped");
      resetTurn();
    }, 800);
  }
}

function resetTurn() {
  firstCard = null;
  secondCard = null;
  lock = false;
}

// ---------------- SHUFFLE ----------------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
