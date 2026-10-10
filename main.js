const joinForm = document.querySelector('#joinForm');
const codeInput = document.querySelector('#code');
const error = document.querySelector('#error');

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  error.textContent = '';
});

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = codeInput.value.trim();
  if (code.length !== 4) {
    error.textContent = 'Enter the 4-letter room code from the big screen.';
    return;
  }
  window.location.assign(`/play?room=${encodeURIComponent(code)}`);
});
