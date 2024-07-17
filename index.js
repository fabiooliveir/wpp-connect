const wppconnect = require('@wppconnect-team/wppconnect');
const dotenv = require('dotenv');
const axios = require('axios');
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require('@google/generative-ai');

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

// Inicializa o wppconnect e chama a função iniciar
wppconnect
  .create({
    puppeteerOptions: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
    },
    disableWelcome: true, // Assumindo que isso desabilita a tela de boas-vindas
  })
  .then((client) => start(client))
  .catch((error) => console.log(error));

// Função que inicia a conexão com o WhatsApp
function start(client) {
  client.onMessage(async (message) => {
    if (!message.isGroupMsg) {
      try {
        // Extrai o nome do contato
        const contactName = message.sender.pushname || message.sender.verifiedName || message.sender.formattedName || 'Contato';

        // Verifica se a mensagem é uma solicitação
        const isRequest = await isRequestMessage(message.body);
        if (isRequest) {
          // Chama o Gemini para gerar a resposta apenas se for uma solicitação
          const response = await getGeminiResponse(contactName, message.body);
          const formattedResponse = `*Gemini:* ${response}`; // Prefixo em negrito
          await client.sendText(message.from, formattedResponse);
          console.log('Resposta do Gemini enviada com sucesso');

          // Cria uma tarefa no Trello
          const taskTitle = `Nova Solicitação de ${contactName}`;
          const taskDescription = `**Mensagem Recebida:**\n${message.body}\n\n**Resposta do Gemini:**\n${response}`;
          await createTrelloTask(taskTitle, taskDescription);
          console.log('Tarefa criada no Trello com sucesso');
        } else {
          console.log('Mensagem não é uma solicitação válida');
        }
      } catch (error) {
        console.error('Erro ao enviar resposta do Gemini ou criar tarefa no Trello: ', error);
      }
    }
  });
}

// Função que verifica se a mensagem é uma solicitação
async function isRequestMessage(inputText) {
  // Use o modelo de análise de intenção do Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: 'Classifique se a mensagem é uma solicitação ou pedido.',
  });

  const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 1024,
    responseMimeType: 'text/plain',
  };

  const chatSession = model.startChat({
    generationConfig,
    history: [
      {
        role: 'user',
        parts: [{ text: 'Esta é uma solicitação?' }],
      },
    ],
  });

  const result = await chatSession.sendMessage(inputText);
  const response = result.response.text().toLowerCase();

  // Define critérios para considerar a mensagem uma solicitação
  return response.includes('sim') || response.includes('pedido') || response.includes('solicitação');
}

// Função que chama a API do Gemini para gerar a resposta
async function getGeminiResponse(contactName, inputText) {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: 'Você é minha recepcionista pessoal',
  });

  const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
    responseMimeType: 'text/plain',
  };

  const chatSession = model.startChat({
    generationConfig,
    history: [
      {
        role: 'user',
        parts: [{ text: 'Quem é Fábio?' }],
      },
      {
        role: 'model',
        parts: [{ text: 'Fábio é meu criador\n' }],
      },
      {
        role: 'user',
        parts: [{ text: 'Qual o cargo do Fábio?' }],
      },
      {
        role: 'model',
        parts: [{ text: 'O Fábio é Analista de dados' }],
      },
      {
        role: 'user',
        parts: [{ text: 'Quem é você?' }],
      },
      {
        role: 'model',
        parts: [{ text: 'Meu nome é Gemini, sou a recepcionista virtual do Fábio' }],
      },
      {
        role: 'user',
        parts: [{ text: 'Posso falar com o Fábio?' }],
      },
      {
        role: 'model',
        parts: [{ text: 'Infelizmente, eu não posso conectar você diretamente com o Fábio. Ele está bastante ocupado com seu trabalho, mas posso transmitir uma mensagem para ele. Você pode me dizer o que gostaria de falar com ele? Ele vai responder assim que puder\n' }],
      },
    ],
  });

  // Inclui o nome do contato na mensagem enviada ao Gemini
  const messageWithContactName = `Mensagem de ${contactName}: ${inputText}`;
  const result = await chatSession.sendMessage(messageWithContactName);
  return result.response.text();
}

// Função que cria uma tarefa no Trello
async function createTrelloTask(title, description) {
  const trelloKey = process.env.TRELLO_KEY;
  const trelloToken = process.env.TRELLO_TOKEN;
  const listId = process.env.TRELLO_LIST_ID;

  const url = `https://api.trello.com/1/cards?key=${trelloKey}&token=${trelloToken}&idList=${listId}&name=${encodeURIComponent(title)}&desc=${encodeURIComponent(description)}`;

  await axios.post(url);
}
