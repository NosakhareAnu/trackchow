require('dotenv').config();

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth-routes');
const foodRoutes = require('./routes/food-routes');
const mealLogRoutes = require('./routes/meal-log-routes');
const summaryRoutes = require('./routes/summary-routes');
const templateRoutes = require('./routes/template-routes');
const syncRoutes = require('./routes/sync-routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'TrackChow backend is running' });
});

// Routes
app.use('/auth', authRoutes);
app.use('/foods', foodRoutes);
app.use('/meal-logs', mealLogRoutes);
app.use('/summary', summaryRoutes);
app.use('/templates', templateRoutes);
app.use('/sync', syncRoutes);

app.listen(PORT, () => {
  console.log(`TrackChow backend running on port ${PORT}`);
});
