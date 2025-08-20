// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Multer для загрузки в память
const storage = multer.memoryStorage();
const upload = multer({ storage });

// MongoDB
const client = new MongoClient(process.env.MONGODB_URI);
let db;
async function connectDB() {
    await client.connect();
    db = client.db(process.env.DB_NAME || 'testdb');
    console.log('✅ MongoDB connected');
}
connectDB().catch(console.error);

// S3 (Supabase Storage)
const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT, 
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
});

// Генерация публичного URL
function getPublicUrl(fileName) {
    return `https://${process.env.SUPABASE_PROJECT}.supabase.co/storage/v1/object/public/${process.env.S3_BUCKET}/${fileName}`;
}

// Генерация автоинкрементного id
async function getNextId() {
    const counter = await db.collection('counters').findOneAndUpdate(
        { _id: "photoid" },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
    );
    return counter.value.seq;
}

// POST — загрузка фото
app.post('/photos', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const fileName = crypto.randomBytes(16).toString('hex') + '.' + req.file.originalname.split('.').pop();

        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: fileName,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        }));

        const newId = await getNextId();

        const photoDoc = {
            id: newId,
            title: req.body.title || 'Untitled',
            fileName,
            createdAt: new Date()
        };

        await db.collection('photos').insertOne(photoDoc);

        const responseObj = {
            id: photoDoc.id,
            title: photoDoc.title,
            fileName: fileName,
            url: getPublicUrl(fileName),
            date: photoDoc.createdAt
        };

        res.json(responseObj);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET — список фото
app.get('/photos', async (req, res) => {
    const photos = await db.collection('photos').find().toArray();

    const formattedPhotos = photos.map(p => ({
        id: p.id,
        title: p.title,
        fileName: p.fileName,
        url: getPublicUrl(p.fileName),
        date: p.createdAt
    }));

    res.json(formattedPhotos);
});

// PUT — обновление названия
app.put('/photos/:id', async (req, res) => {
    const { id } = req.params;
    const { title } = req.body;

    const result = await db.collection('photos').findOneAndUpdate(
        { id: parseInt(id) },
        { $set: { title } },
        { returnDocument: 'after' }
    );

    if (!result.value) return res.status(404).json({ error: 'Not found' });

    res.json({
        id: result.value.id,
        title: result.value.title,
        fileName: result.value.fileName,
        url: getPublicUrl(result.value.fileName),
        date: result.value.createdAt
    });
});

// DELETE — удаление фото
app.delete('/photos/:id', async (req, res) => {
    const { id } = req.params;
    const photo = await db.collection('photos').findOne({ id: parseInt(id) });
    if (!photo) return res.status(404).json({ error: 'Not found' });

    await s3.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: photo.fileName
    }));

    await db.collection('photos').deleteOne({ id: parseInt(id) });
    res.json({ message: 'Deleted' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
