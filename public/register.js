const button = document.querySelector('#register');
const status = document.querySelector('[role=status]');

button.onclick = async () => {
  button.disabled = true;
  try {
    const response = await fetch('/api/accounts/register', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Регистрация недоступна');
    document.querySelector('#username').value = result.username;
    document.querySelector('#password').value = result.password;
    document.querySelector('#credentials').hidden = false;
    status.textContent = 'Аккаунт создан. Сохраните данные для входа.';
    button.hidden = true;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
