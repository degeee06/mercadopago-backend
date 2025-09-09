import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// Inicializa Mercado Pago (Sandbox ou Produção)
const { MercadoPagoConfig, Payment } = mercadopago;
const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN // TEST-xxx para Sandbox
});
const payment = new Payment(mp);

// Endpoint para criar PIX
app.post("/create-pix", async (req, res) => {
  const { amount, description, email } = req.body;

  try {
    const result = await payment.create({
      body: {
        transaction_amount: Number(amount),
        description: description || "Pagamento VIP",
        payment_method_id: "pix",
        payer: { email: email }
      }
    });

    res.json({
      id: result.id,
      status: result.status,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook do Mercado Pago com validação de assinatura
app.post("/webhook", async (req, res) => {
  const topic = req.query.topic; // payment ou merchant_order
  const id = req.query.id;       // ID do pagamento ou pedido

  // Validação da assinatura
  const signature = req.headers["x-meli-signature"] || req.headers["x-signature"];
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!signature || signature !== secret) {
    console.log("Webhook inválido! Assinatura não conferiu.");
    return res.sendStatus(401); // não autorizado
  }

  console.log("=== Webhook validado ===");
  console.log("Topic:", topic);
  console.log("ID:", id);
  console.log("Body:", req.body);

  // Opcional: consultar detalhes do pagamento
  try {
    if (topic === "payment") {
      const paymentDetails = await mp.payment.findById(id);
      console.log("Detalhes do pagamento:", paymentDetails);
      // Aqui você pode atualizar o banco de dados ou liberar VIP
    }
  } catch (err) {
    console.error("Erro ao buscar detalhes do pagamento:", err.message);
  }

  res.sendStatus(200); // Retorna 200 para o Mercado Pago
});


// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
