import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ Coloque seu token de produção ou sandbox aqui
mercadopago.configurations.setAccessToken("TEST-6172816457651620-090719-ef2ac7e7628cc5b8a64d2ca1ddf89c61-469548398");

// Criar pagamento PIX
app.post("/create-pix", async (req, res) => {
  const { amount, description, email } = req.body;

  try {
    const paymentData = {
      transaction_amount: Number(amount),
      description: description || "Pagamento PIX",
      payment_method_id: "pix",
      payer: {
        email: email || "cliente@exemplo.com"
      }
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

app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando!");
});
