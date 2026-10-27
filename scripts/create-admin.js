// Creates an admin panel user or resets an existing user's password.
// Usage: npm run create-admin -- <login> <password> [admin|editor|moderator]
const { get, run } = require('../src/db');
const { hashPassword } = require('../src/security');

const [username, password, role = 'admin'] = process.argv.slice(2);
if (!username || !password) {
  console.error('Использование: npm run create-admin -- <логин> <пароль> [admin|editor|moderator]');
  process.exit(1);
}
if (!/^[\w.-]{3,60}$/.test(username)) { console.error('Логин: 3–60 латинских букв, цифр, точек или дефисов'); process.exit(1); }
if (password.length < 10) { console.error('Пароль должен быть не короче 10 символов'); process.exit(1); }
if (!['admin', 'editor', 'moderator'].includes(role)) { console.error('Роль: admin, editor или moderator'); process.exit(1); }

if (get('SELECT 1 FROM users WHERE username = ?', username)) {
  run('UPDATE users SET password_hash = ?, role = ? WHERE username = ?', hashPassword(password), role, username);
  run('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)', username);
  console.log(`Пароль пользователя «${username}» обновлен (роль: ${role}).`);
} else {
  run('INSERT INTO users(username, password_hash, role) VALUES(?,?,?)', username, hashPassword(password), role);
  console.log(`Пользователь «${username}» создан (роль: ${role}). Вход: /admin`);
}
