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

// Serve frontend (opcional)
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

// Inicializa Mercado Pago
const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(mpClient);

// Inicializa Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// =======================
// Cria pagamento PIX
// =======================
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
    await supabase.from("pagamentos").upsert(
      [
        { id: result.id, email, amount: Number(amount), status: "pending" }
      ],
      { onConflict: ["id"] }
    );

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

// =======================
// Checa status PIX
// =======================
app.get("/status-pix/:id", async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.from("pagamentos").select("status").eq("id", id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: data?.status || "pending" });
});

// =======================
// Webhook Mercado Pago
// =======================
app.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-signature"];
    const secret = process.env.MP_WEBHOOK_SECRET;

    if (!signature || !secret) return res.sendStatus(401);

    // Validação simples da assinatura
    const parts = signature.split(",");
    let ts = "", v1 = "";
    for (const p of parts) {
      const [key, value] = p.split("=");
      if (key === "ts") ts = value;
      if (key === "v1") v1 = value;
    }

    const dataId = (req.query["data.id"] || "").toLowerCase();
    const xRequestId = req.headers["x-request-id"] || "";
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const computedHash = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    if (computedHash !== v1) return res.sendStatus(401);

    console.log("Webhook validado ✅");

    // Atualiza Supabase
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.sendStatus(400);

    // Consulta status real do pagamento
    const paymentDetails = await payment.get({ id: paymentId });

    let updateData = { status: paymentDetails.status };
    if (paymentDetails.status === "approved" || paymentDetails.status === "paid") {
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30); // VIP 30 dias
      updateData.valid_until = validUntil.toISOString();
    }

    const { error } = await supabase.from("pagamentos")
      .update(updateData)
      .eq("id", paymentId);

    if (error) console.error("Erro ao atualizar Supabase:", error.message);
    else console.log(`Pagamento ${paymentId} atualizado para ${paymentDetails.status}`);

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err.message);
    res.sendStatus(500);
  }
});

// =======================
// Verifica VIP pelo email
// =======================
app.get("/is-vip/:email", async (req, res) => {
  const email = req.params.email;
  const { data, error } = await supabase
    .from("pagamentos")
    .select("valid_until, status")
    .eq("email", email)
    .order("valid_until", { ascending: false })
    .limit(1)
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const now = new Date();
  const valid = data?.status === "approved" && data?.valid_until && new Date(data.valid_until) > now;
  res.json({ vip: valid, valid_until: data?.valid_until });
});

// =======================
// Inicia servidor
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
