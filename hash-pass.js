// hash-pass.js
import bcrypt from 'bcryptjs';

const password = '123'; // ← cambia por la contraseña que quieras
const hash = bcrypt.hashSync(password, 10);
console.log('Hash para', password, ':', hash);