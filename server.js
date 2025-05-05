Mohamed Hachem Chaabi, [03/05/2025 14:32]
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const mqtt = require("mqtt");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const swaggerJsDoc = require("swagger-jsdoc");
const Joi = require("joi");

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(morgan("combined"));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: "تم تجاوز الحد الأقصى للطلبات. يرجى المحاولة لاحقًا."
});
app.use(limiter);

// Connexion à MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log("💾 متصل بقاعدة البيانات MongoDB"))
    .catch(err => console.error("خطأ في الاتصال بقاعدة البيانات:", err));

// Schéma Mongoose
const EnergySchema = new mongoose.Schema({
    temperature: Number,
    humidity: Number,
    voltage: Number,
    current_20A: Number,
    current_30A: Number,
    sct013: Number,
    waterFlow: Number,
    gasDetected: Number, // <- ici en Number
    level: Number,
    timestamp: { type: Date, default: Date.now }
});
const EnergyModel = mongoose.model("Energy", EnergySchema);

// Connexion au broker MQTT
const client = mqtt.connect(process.env.MQTT_BROKER);

client.on("connect", () => {
    console.log("🔗 متصل بخادم MQTT");
    client.subscribe("maison/energie"); // Adapte selon ton ESP32
});

// Réception et enregistrement des données MQTT
client.on("message", (topic, message) => {
    try {
        const data = JSON.parse(message.toString());

        const newEntry = new EnergyModel({
            temperature: data.temperature ?? null,
            humidity: data.humidity ?? null,
            voltage: data.voltage ?? null,
            current_20A: data.current_20A ?? null,
            current_30A: data.current_30A ?? null,
            sct013: data.sct013 ?? null,
            waterFlow: data.waterFlow ?? null,
            gasDetected: data.gasDetected ?? null, // <- en nombre
            level: data.level ?? null
        });

        newEntry.save()
            .then(() => console.log("✅ تم حفظ بيانات MQTT بنجاح:", newEntry))
            .catch(err => console.error("❌ خطأ أثناء حفظ البيانات:", err));

    } catch (error) {
        console.error("⚠️ خطأ في تحويل رسالة MQTT إلى JSON:", error);
    }
});

// Endpoint racine
app.get("/", (req, res) => {
    res.send("🚀 الخادم يعمل بنجاح!");
});

// Récupérer les 10 dernières entrées
app.get("/energy", async (req, res) => {
    try {
        const data = await EnergyModel.find().sort({ timestamp: -1 }).limit(10);
        res.json(data);
    } catch (error) {
        res.status(500).send("خطأ في جلب البيانات.");
    }
});

// Enregistrement manuel via POST
app.post("/energy", async (req, res) => {
    const schema = Joi.object({
        temperature: Joi.number(),
        humidity: Joi.number(),
        voltage: Joi.number(),
        current_20A: Joi.number(),
        current_30A: Joi.number(),
        sct013: Joi.number(),
        waterFlow: Joi.number(),
        gasDetected: Joi.number(), // <- ici aussi en number
        level: Joi.number()
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    try {
        const newData = new EnergyModel(req.body);
        await newData.save();
        res.status(201).json({ message: "📊 تم حفظ البيانات بنجاح!" });
    } catch (error) {
        res.status(500).send("خطأ أثناء حفظ البيانات.");
    }
});

Mohamed Hachem Chaabi, [03/05/2025 14:32]
// Documentation Swagger
const swaggerOptions = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "API إدارة الطاقة وكشف الغاز",
            version: "1.0.0",
            description: "API لجمع بيانات استهلاك الطاقة والمياه وكشف الغاز"
        },
        servers: [{ url: "http://localhost:5000" }]
    },
    apis: ["server.js"]
};
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Lancer le serveur
app.listen(PORT, () => {
    console.log(🚀 الخادم يعمل على http://localhost:${PORT});
});
