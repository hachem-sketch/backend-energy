require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const cors = require('cors');
const helmet = require('helmet');
const { HfInference } = require('@huggingface/inference');
const Joi = require('joi');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware de base
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'OPTIONS']
}));
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// Connexion MongoDB (version moderne)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connecté à MongoDB'))
  .catch(err => {
    console.error('❌ Erreur MongoDB:', err.message);
    process.exit(1);
  });

// Schéma Mongoose
const EnergySchema = new mongoose.Schema({
  temperature: Number,
  humidity: Number,
  voltage: Number,
  current_20A: Number,
  current_30A: Number,
  sct013: Number,
  waterFlow: Number,
  gasDetected: Number,
  level: Number,
  timestamp: { type: Date, default: Date.now, index: true }
});

const EnergyModel = mongoose.model('Energy', EnergySchema);

// Configuration MQTT
const mqttClient = mqtt.connect(process.env.MQTT_BROKER, {
  clientId: `nawerli-${Math.random().toString(16).substr(2, 8)}`,
  reconnectPeriod: 5000
});

mqttClient.on('connect', () => {
  console.log('🔗 Connecté à MQTT');
  mqttClient.subscribe('maison/energie', { qos: 1 });
});

mqttClient.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    await EnergyModel.create(data);
    console.log(`📊 Données MQTT sauvegardées: ${new Date().toISOString()}`);
  } catch (err) {
    console.error('⚠️ Erreur traitement MQTT:', err.message);
  }
});

// Initialisation Hugging Face
const hf = new HfInference(process.env.HF_TOKEN);

// Routes API
app.get('/', (req, res) => {
  res.send('🚀 Serveur Nawerli - Documentation API sur /api-docs');
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'active',
    services: {
      mongoDB: mongoose.connection.readyState === 1,
      mqtt: mqttClient.connected,
      hf: !!process.env.HF_TOKEN
    },
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/energy', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const data = await EnergyModel.find().sort('-timestamp').limit(limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

app.post('/api/chatbot', async (req, res) => {
  const schema = Joi.object({
    question: Joi.string().min(3).max(500).required()
  });

  const { error } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const response = await hf.textGeneration({
      model: 'microsoft/DialoGPT-medium-arabic',
      inputs: req.body.question,
      parameters: { max_length: 200 }
    });
    res.json({ answer: response.generated_text });
  } catch (err) {
    res.status(503).json({ error: 'Service IA indisponible' });
  }
});

// Documentation Swagger
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Nawerli Energy',
      version: '1.0.0',
      description: 'API pour la gestion des données énergétiques'
    },
    servers: [{ url: `http://localhost:${PORT}` }]
  },
  apis: ['./server.js']
};

const swaggerSpec = require('swagger-jsdoc')(swaggerOptions);
app.use('/api-docs', require('swagger-ui-express').serve, require('swagger-ui-express').setup(swaggerSpec));

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error('💥 Erreur:', err.stack);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📚 Documentation: http://localhost:${PORT}/api-docs`);
});

// Gestion de la fermeture
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur...');
  mongoose.connection.close();
  mqttClient.end();
  process.exit(0);
});
