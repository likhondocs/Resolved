
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const edgedb = require('edgedb');
const session = require('express-session');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// EdgeDB setup
const edgedbClient = edgedb.createClient();

// Middleware setup
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// GitHub OAuth setup
passport.use(new GitHubStrategy({
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: "https://resolved-alpha.vercel.app/success"
},
async function(accessToken, refreshToken, profile, done) {
  try {
    const user = await edgedbClient.querySingle(\`
      SELECT (INSERT User {
        github_id := <str>$github_id,
        username := <str>$username
      } UNLESS CONFLICT ON .github_id
      ELSE (
        UPDATE User SET { username := <str>$username }
      ))
    \`, {
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
    const user = await edgedbClient.querySingle(\`
      SELECT User {
        id,
        github_id,
        username
      }
      FILTER .id = <uuid>$id
    \`, { id });
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

// Function to fetch and update proxy lists
async function updateProxyLists() {
  for (const [type, url] of Object.entries(proxyLists)) {
    try {
      const response = await axios.get(url);
      fs.writeFileSync(\`./data/\${type}.txt\`, response.data);
      console.log(\`Updated \${type} proxy list\`);
    } catch (error) {
      console.error(\`Error updating \${type} proxy list:\`, error.message);
    }
  }
}

// Schedule proxy list updates every hour
cron.schedule('0 * * * *', updateProxyLists);

// API endpoints
app.get('/api/proxies/:type', (req, res) => {
  const { type } = req.params;
  if (!proxyLists[type]) {
    return res.status(400).json({ error: 'Invalid proxy type' });
  }

  try {
    const proxyList = fs.readFileSync(\`./data/\${type}.txt\`, 'utf-8');
    res.send(proxyList);
  } catch (error) {
    res.status(500).json({ error: 'Error reading proxy list' });
  }
});

// Auth routes
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));

app.get('/success',
  passport.authenticate('github', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.get('/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
  updateProxyLists(); // Initial update
});
