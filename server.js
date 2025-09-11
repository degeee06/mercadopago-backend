import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";
import Twilio from "twilio";
import axios from "axios";

dotenv.config();
const app = express();
app.use(bodyParser.json());

// -------------------- Supabase --------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -------------------- Twilio --------------------
const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

// -------------------- Hugging Face --------------------
async function gerarRespostaHF(prompt) {
  try {
    const res = await axios.post(
      "https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct",
      { inputs: prompt },
      { headers: { Authorization: `Bearer ${process.env.HF_API_KEY}` } }
    );
    return res.data[0]?.generated_text || "🤖 Não consegui gerar resposta.";
  } catch (err) {
    console.error("Erro Hugging Face:", err.response?.data || err.message);
    return "🤖 Ocorreu um erro ao gerar a resposta.";
  }
}

// -------------------- Rotas --------------------

// Teste do bot
app.get("/", (req, res) => res.send("Bot rodando ✅"));

// Webhook Twilio (WhatsApp)
// Webhook Twilio (WhatsApp)
app.post("/webhook", async (req, res) => {
  try {
    const msgFrom = req.body.From;
    const msgBody = req.body.Body || "";

    // Pega lead existente
    let { data: lead, error } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", msgFrom)
      .single();

    // Se não existir, cria lead
    if (!lead) {
      const hoje = new Date().toISOString().split("T")[0];
      const { data: newLead, error: insertError } = await supabase
        .from("leads")
        .insert({
          name: "Cliente WhatsApp",
          phone: msgFrom,
          message: msgBody,
          paid: false,
          msg_count: 0,
          last_msg_date: hoje
        })
        .select()
        .single();

      if (insertError) {
        console.error("Erro ao criar lead:", insertError);
        return res.sendStatus(500);
      }

      lead = newLead; // garante que lead não seja null
    }

    // Agora lead existe
    const hoje = new Date().toISOString().split("T")[0];

    // Reset diário
    if (!lead.last_msg_date || lead.last_msg_date !== hoje) {
      await supabase
        .from("leads")
        .update({ msg_count: 0, last_msg_date: hoje })
        .eq("id", lead.id);
      lead.msg_count = 0;
    }

    // Limite diário para não-pagos
    if (!lead.paid && lead.msg_count >= 10) {
      await client.messages.create({
        from: TWILIO_NUMBER,
        to: msgFrom,
        body:
          "🚀 Você atingiu o limite diário de 10 mensagens grátis.\n\n" +
          "👉 Para desbloquear uso ilimitado, faça o upgrade para o plano VIP: \n" +
          process.env.MP_PAYMENT_LINK
      });
      return res.sendStatus(200);
    }

    // Resposta IA gratuita Hugging Face
    const reply = await gerarRespostaHF(msgBody);

    // Envia mensagem
    await client.messages.create({
      from: TWILIO_NUMBER,
      to: msgFrom,
      body: reply,
    });

    // Atualiza contador
    await supabase
      .from("leads")
      .update({ msg_count: (lead.msg_count || 0) + 1 })
      .eq("id", lead.id);

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook Twilio:", err);
    res.sendStatus(500);
  }
});


// -------------------- Servidor --------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
