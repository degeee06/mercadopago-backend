import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

// Inicializa Mercado Pago (SDK atual)
const { MercadoPagoConfig, Payment } = mercadopago;
const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(mp);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve a pasta public da raiz do projeto
app.use(express.static(path.join(__dirname, "public")));

// Endpoint PIX
app.post("/create-pix", async (req, res) => {
  const { amount, description, email } = req.body;
  try {
    const result = await payment.create({
      body: {
        transaction_amount: Number(amount),
        description: description || "Pagamento PIX",
        payment_method_id: "pix",
        payer: {
          email: email || "teste@cliente.com",
        },
      },
    });

    res.json({
      id: result.id,
      status: result.status,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve o index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando!");
});
