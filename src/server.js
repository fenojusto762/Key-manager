const app = require('./app');
const config = require('./config');

if (config.missing.length) {
  console.warn(
    `[aviso] Variáveis de ambiente ausentes: ${config.missing.join(', ')}. ` +
      'Copie .env.example para .env e preencha os valores.'
  );
}

app.listen(config.port, () => {
  console.log(`KEY MANAGER em http://localhost:${config.port}`);
});
