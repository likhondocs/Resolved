const express = require('express');
const axios = require('axios');
const edgedb = require('edgedb');
const session = require('express-session');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
require('dotenv').config();

const app = express();

// EdgeDB setup
let edgedbClient;
if (process.env.VERCEL_ENV === 'production') {
  edgedbClient = edgedb.createClient({
    tlsSecurity: 'strict',
    host: process.env.EDGEDB_HOST,
    port: process.env.EDGEDB_PORT,
    user: process.env.EDGEDB_USER,
    password: process.env.EDGEDB_PASSWORD,
    database: process.env.EDGEDB_DATABASE,
  });
} else {
  edgedbClient = edgedb.createClient();
}

// Middleware setup
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
app.use(passport.initialize());
app.use(passport.session());

// GitHub OAuth setup
passport.use(new GitHubStrategy({
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: `${process.env.BASE_URL}/auth/github/callback`
},
async function(accessToken, refreshToken, profile, done) {
  try {
    const user = await edgedbClient.querySingle(`
      WITH
        github_id := <str>$github_id,
        username := <str>$username
      SELECT (
        INSERT User {
          github_id := github_id,
          username := username
        }
        UNLESS CONFLICT ON .github_id
        ELSE (
          UPDATE User
          SET { username := username }
        )
      ) {
        id,
        github_id,
        username
      }
    `, {
      github_id: profile.id,
      username: profile.username
    });
    done(null, user);
  } catch (error) {
    done(error);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await edgedbClient.querySingle(`
      SELECT User {
        id,
        github_id,
        username
      }
      FILTER .id = <uuid>$id
    `, { id });
    done(null, user);
  } catch (error) {
    done(error);
  }
});

// Proxy lists
const proxyLists = {
  http: 'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt',
  socks4: 'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks4.txt',
  socks5: 'https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt'
};

// Function to fetch proxy lists
async function fetchProxyList(type) {
  try {
    const response = await axios.get(proxyLists[type]);
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${type} proxy list:`, error.message);
    return '';
  }
}

// API endpoints
app.get('/api/proxies/:type', async (req, res) => {
  const { type } = req.params;
  if (!proxyLists[type]) {
    return res.status(400).json({ error: 'Invalid proxy type' });
  }
  try {
    const proxyList = await fetchProxyList(type);
    res.send(proxyList);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching proxy list' });
  }
});

// Auth routes
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));

app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Error during logout:', err);
    }
    res.redirect('/');
  });
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/public/index.html');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
