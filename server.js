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
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 1000,
    message: "تم تجاوز الحد الأقصى للطلبات. يرجى المحاولة لاحقًا."
});
app.use(limiter);

// الاتصال بقاعدة البيانات MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("💾 متصل بقاعدة البيانات MongoDB"))
    .catch(err => console.error("خطأ في الاتصال بقاعدة البيانات:", err));

// تعريف نموذج البيانات
const EnergySchema = new mongoose.Schema({
    temperature: Number,
    humidity: Number,
    voltage: Number,
    current_20A: Number,
    current_30A: Number,
    sct013: Number,
    waterFlow: Number,
    gasDetected: Boolean,
    timestamp: { type: Date, default: Date.now }
});
const EnergyModel = mongoose.model("Energy", EnergySchema);

// الاتصال بخادم MQTT
const client = mqtt.connect(process.env.MQTT_BROKER);

client.on("connect", () => {
    console.log("🔗 متصل بخادم MQTT");
    client.subscribe("maison/energie"); // عدل اسم التوبيك حسب ما تستعمله في ESP32
});

// استقبال البيانات من MQTT وتخزينها في MongoDB
client.on("message", (topic, message) => {
    try {
        let data = JSON.parse(message.toString());

        const {
            temperature,
            humidity,
            voltage,
            current_20A,
            current_30A,
            sct013,
            waterFlow,
            gasDetected
        } = data;

        const newEntry = new EnergyModel({
            temperature: temperature !== undefined ? temperature : null,
            humidity: humidity !== undefined ? humidity : null,
            voltage: voltage !== undefined ? voltage : null,
            current_20A: current_20A !== undefined ? current_20A : null,
            current_30A: current_30A !== undefined ? current_30A : null,
            sct013: sct013 !== undefined ? sct013 : null,
            waterFlow: waterFlow !== undefined ? waterFlow : null,
            gasDetected: gasDetected !== undefined ? gasDetected : false
        });

        newEntry.save()
            .then(() => console.log("✅ تم حفظ بيانات MQTT بنجاح:", newEntry))
            .catch(err => console.error("❌ خطأ أثناء حفظ البيانات:", err));

    } catch (error) {
        console.error("⚠️ خطأ في تحويل رسالة MQTT إلى JSON:", error);
    }
});

// نقطة البداية (اختبار الخادم)
app.get("/", (req, res) => {
    res.send("🚀 الخادم يعمل بنجاح!");
});

// جلب آخر 10 سجلات من قاعدة البيانات
app.get("/energy", async (req, res) => {
    try {
        const data = await EnergyModel.find().sort({ timestamp: -1 }).limit(10);
        res.json(data);
    } catch (error) {
        res.status(500).send("خطأ في جلب البيانات.");
    }
});

// استقبال بيانات يدويًا عبر POST
app.post("/energy", async (req, res) => {
    const { error } = Joi.object({
        temperature: Joi.number(),
        humidity: Joi.number(),
        voltage: Joi.number(),
        current_20A: Joi.number(),
        current_30A: Joi.number(),
        sct013: Joi.number(),
        waterFlow: Joi.number(),
        gasDetected: Joi.boolean()
    }).validate(req.body);

    if (error) return res.status(400).send(error.details[0].message);

    try {
        const { temperature, humidity, voltage, current_20A, current_30A, sct013, gasDetected, waterFlow  } = req.body;
        const newData = new EnergyModel({
            temperature,
            humidity,
            voltage,
            current_20A,
            current_30A,
            sct013,
            waterFlow,
            gasDetected
        });
        await newData.save();
        res.status(201).json({ message: "📊 تم حفظ البيانات بنجاح!" });
    } catch (error) {
        res.status(500).send("خطأ أثناء حفظ البيانات.");
    }
});

// إعداد Swagger لتوثيق الـ API
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

// تشغيل الخادم
app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});
