# 24 PAY v1.3 — deploy de demonstração

**Não realiza pagamentos, recargas, saques ou comissões reais.** O banco armazena dados de demonstração, inclusive cadastros e solicitações.

## Windows (teste local)
1. Instale Node.js 20+.
2. Na pasta, execute `npm install` e `npm start`.
3. Abra http://localhost:3000.
4. Sem `DATABASE_URL`, os dados são guardados no arquivo local `data.json`.

## GitHub + Render + PostgreSQL
1. Crie repositório **privado** no GitHub e envie estes arquivos, sem `.env` nem `data.json`.
2. Crie banco PostgreSQL gerenciado com conexão TLS e obtenha a URL de conexão.
3. No Render, crie Web Service conectado ao repositório; `render.yaml` documenta o build e o start.
4. Configure no Render `DATABASE_URL` (segredo) e `ADMIN_EMAIL` (e-mail que você cadastrará no site). Não compartilhe senhas aqui.
5. Faça deploy. Acesse a URL fornecida pelo Render e cadastre-se usando o e-mail configurado em `ADMIN_EMAIL`.
6. **Reinicie o serviço** para que a inicialização promova esse cadastro ao perfil de administrador. Faça novo login.
7. Acesse o painel administrativo para configurar margens por serviço.

## Limitações obrigatórias
- Banco PostgreSQL é usado como persistência de um único documento JSON, **não** como razão contábil transacional; usar apenas **uma instância** e para demonstração. Requisições simultâneas podem sobrescrever alterações. Para produção, migrar para tabelas transacionais, travas, auditoria e migrações.
- Sessões em memória são perdidas em reinicializações, exigindo novo login.
- Sem proteção completa contra tentativas de login, CSRF, abusos, nem recuperação de senha.
- `ADMIN_EMAIL` deve ser mantido sob controle do proprietário e removido após o primeiro bootstrap, com política de acesso apropriada.
- Valores de custo, taxas e comissões são exemplos; nenhum lucro é realizado nesta versão.
- O certificado TLS do PostgreSQL precisa ser validado. Caso o provedor utilize CA privada, configurar a CA confiável; não desabilitar a validação em produção.
- Não divulgar publicamente o link como plataforma financeira operacional até implementação de segurança, compliance e integração autorizada.
