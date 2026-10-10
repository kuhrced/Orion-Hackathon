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
