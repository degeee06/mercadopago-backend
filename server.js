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

// Inicializa Mercado Pago com token de Produção
const { MercadoPagoConfig, Payment } = mercadopago;
const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN // token PROD-xxx
});
const payment = new Payment(mp);

// Armazena status de pagamentos em memória (temporário)
const pagamentos = {};

// Endpoint para criar PIX
app.post("/create-pix", async (req, res) => {
  const { amount, description, email } = req.body;

  try {
    const result = await payment.create({
      body: {
        transaction_amount: Number(amount),
        description: description || "Pagamento VIP",
        payment_method_id: "pix",
        payer: { email: email } // email real do cliente
      }
    });

    pagamentos[result.id] = "pending"; // status inicial

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

// Endpoint para checar status do pagamento (frontend faz polling)
app.get("/status-pix/:id", (req, res) => {
  const id = req.params.id;
  const status = pagamentos[id] || "pending";
  res.json({ status });
});

// Webhook do Mercado Pago com validação de assinatura
app.post("/webhook", async (req, res) => {
  const topic = req.query.topic;
  const id = req.query.id;

  // Validação da assinatura do webhook
  const signature = req.headers["x-meli-signature"] || req.headers["x-signature"];
  const secret = process.env.MP_WEBHOOK_SECRET; // chave secreta PROD

  if (!signature || signature !== secret) {
    console.log("Webhook inválido! Assinatura não conferiu.");
    return res.sendStatus(401);
  }

  console.log("=== Webhook validado ===");
  console.log("Topic:", topic, "ID:", id);

  try {
    if (topic === "payment") {
      const paymentDetails = await mp.payment.findById(id);
      console.log("Detalhes do pagamento:", paymentDetails);

      pagamentos[id] = paymentDetails.status; // atualiza status

      // Aqui você pode liberar VIP ou atualizar banco
    }
  } catch (err) {
    console.error("Erro ao buscar detalhes do pagamento:", err.message);
  }

  res.sendStatus(200);
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
