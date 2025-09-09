import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

// Configura token via variável de ambiente
mercadopago.configurations.setAccessToken(process.env.MP_ACCESS_TOKEN);

// Frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// Endpoint PIX
app.post("/create-pix", async (req, res) => {
  const { amount, description, email } = req.body;
  try {
    const paymentData = {
      transaction_amount: Number(amount),
      description: description || "Pagamento PIX",
      payment_method_id: "pix",
      payer: { email: email || "teste@cliente.com" }
    };

    const payment = await mercadopago.payment.create(paymentData);

    res.json({
      id: payment.body.id,
      status: payment.body.status,
      qr_code: payment.body.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: payment.body.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando!");
});
