import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

// Inicializa Mercado Pago
const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(mpClient);

// Inicializa Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Cria PIX
app.post("/create-pix", async (req, res) => {
  const { amount, description, email } = req.body;
  if (!amount || !email) return res.status(400).json({ error: "Faltando dados" });

  try {
    const result = await payment.create({
      body: {
        transaction_amount: Number(amount),
        description: description || "Pagamento VIP",
        payment_method_id: "pix",
        payer: { email },
      },
    });

    // Salva no Supabase
    await supabase.from("pagamentos").insert([
      { id: result.id, email, amount: Number(amount), status: "pending" }
    ]);

    res.json({
      id: result.id,
      status: result.status,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Checa status do pagamento
app.get("/status-pix/:id", async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.from("pagamentos").select("status").eq("id", id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: data?.status || "pending" });
});

// Webhook Mercado Pago
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const signatureHeader = req.headers["x-signature"];
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!signatureHeader || !secret) return res.sendStatus(401);

  // Validação HMAC (igual antes)
  const parts = signatureHeader.split(",");
  let ts = "", v1 = "";
  for (const p of parts) {
    const [key, value] = p.split("=");
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value;
  }
  const dataId = (req.query["data.id"] || "").toLowerCase();
  const xRequestId = req.headers["x-request-id"] || "";
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const computedHash = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  if (computedHash !== v1) return res.sendStatus(401);

  console.log("Webhook validado ✅");

  try {
    const paymentId = req.body?.data?.id || req.query.id;
    if (!paymentId) return res.sendStatus(400);

    // Atualiza no Supabase diretamente, sem chamar Payment.get()
    await supabase.from("pagamentos")
      .update({ status: "approved" })
      .eq("id", paymentId);

    console.log("Status atualizado pelo Webhook:", "approved");

  } catch (err) {
    console.error("Erro ao atualizar pagamento:", err.message);
  }

  res.sendStatus(200);
});


// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
