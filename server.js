require('dotenv').config();
const { createServer } = require('./server/app');

const PORT = process.env.PORT || 3000;

createServer().listen(PORT, () => {
  console.log(`Guessing server running on http://localhost:${PORT}`);
});
