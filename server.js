import express from 'express';
import cors from 'cors';
import mercadopago from 'mercadopago';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

// Inicializa o SDK com o access token
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

app.post('/create_payment', async (req, res) => {
  const { token, email, amount, paymentMethod } = req.body;

  try {
    const paymentData = {
      transaction_amount: amount,
      description: 'Pagamento Flutter',
      installments: 1,
      payer: { email: email },
    };

    if (paymentMethod === 'card') {
      paymentData.token = token;
      paymentData.payment_method_id = 'master';
    }

    if (paymentMethod === 'pix') {
      paymentData.payment_method_id = 'pix';
    }

    const payment = await mercadopago.payment.create(paymentData);
    res.status(201).json(payment.response);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(3000, () => console.log('Server rodando na porta 3000'));
