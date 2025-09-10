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
    await supabase.from("pagamentos").select('*')
      [{ id: result.id, email, amount: Number(amount), status: "pending" }],
      { onConflict: ["id"] }
    );

    res.json({
      id: result.id,
      status: result.status,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (err) {
    console.error("Erro create-pix:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Webhook Mercado Pago
// =======================
// =======================
// Webhook Mercado Pago seguro
// =======================
app.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-signature"];
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!signature || !secret) return res.sendStatus(401);

    // Validação da assinatura
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

    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.sendStatus(400);

    // Busca status atual no Mercado Pago
    const paymentDetails = await payment.get({ id: paymentId });

    // Busca registro atual no Supabase
    const { data: existingData, error: fetchError } = await supabase
      .from("pagamentos")
      .select("status, valid_until")
      .eq("id", paymentId)
      .single();

    if (fetchError) {
      console.error("Erro ao buscar pagamento no Supabase:", fetchError.message);
      return res.sendStatus(500);
    }

    // Prepara dados para atualização
    let updateData = {};

    // Atualiza status sempre
    updateData.status = paymentDetails.status;

    // Só atualiza VIP se aprovado/pago **e não houver valid_until vigente**
    const now = new Date();
    const hasVipActive = existingData?.valid_until && new Date(existingData.valid_until) > now;

    if ((paymentDetails.status === "approved" || paymentDetails.status === "paid") && !hasVipActive) {
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 30);
      updateData.valid_until = validUntil.toISOString();
    }

    // Atualiza Supabase
    const { error: updateError } = await supabase
      .from("pagamentos")
      .update(updateData)
      .eq("id", paymentId);

    if (updateError) console.error("Erro ao atualizar Supabase:", updateError.message);
    else console.log(`Pagamento ${paymentId} atualizado para ${paymentDetails.status}`);

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook:", err.message);
    res.sendStatus(500);
  }
});


// =======================
// Verifica VIP pelo email
// =======================
app.get('/check-vip/:email', async (req, res) => {
  const { email } = req.params;

  const { data, error } = await supabase
    .from('pagamentos') // ✅ corrigido
    .select('*')
    .eq('email', email)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    return res.status(500).json({ vip: false, valid_until: null });
  }

  if (data && data.length > 0) {
    const payment = data[0];
    const validUntil = payment.valid_until ? new Date(payment.valid_until) : null;

    if (validUntil && validUntil > new Date()) {
      return res.json({ vip: true, valid_until: validUntil });
    }
  }

  return res.json({ vip: false, valid_until: null });
});


// =======================
// Inicia servidor
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
