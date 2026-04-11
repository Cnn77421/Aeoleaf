require('dotenv').config();
const express = require('express');
const session = require('express-session');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const { initDB } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

(async () => {
  await initDB();

app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use('/api/auth', require('./routes/api/auth'));
app.use('/api/posts', require('./routes/api/posts'));
app.use('/api/works', require('./routes/api/works'));
app.use('/api/search', require('./routes/api/search'));
app.use('/', require('./routes/api/sitemap'));
app.use('/', require('./routes/api/rss'));
app.use('/', require('./routes/pages'));

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: err.message });
  }
  res.status(500).render('404', { title: 'Error' });
});

  app.listen(PORT, () => {
    console.log(`aeoleaf running on http://localhost:${PORT}`);
  });
})();
