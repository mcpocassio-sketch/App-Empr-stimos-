# Meus Empréstimos

App web simples (HTML, CSS e JavaScript puro, sem backend) para controlar empréstimos feitos a outras pessoas e calcular o lucro real.

## Como usar

Abra `app-emprestimos/index.html` no navegador (no celular ou no computador). No primeiro acesso, crie uma senha.

Os dados ficam salvos no `localStorage` **deste navegador**. Use **Dados → Exportar backup (JSON)** regularmente e **Importar backup** para restaurar ou levar os dados para outro aparelho.

## Funcionalidades

- Cadastro de empréstimos: nome, data, valor emprestado, total a receber (com juros), parcelas com vencimento e valor editáveis, observações.
- Pagamentos parciais ou de parcelas, com data, valor e observação (editar/excluir).
- Status automático: **Em dia**, **Atrasado**, **Quitado**; **Calote** marcado manualmente.
- Painel: total emprestado, a receber, recebido, pendente, em atraso, perdido (calotes), lucro previsto e **lucro real** em destaque.
- Lista com filtro por pessoa, status e busca; tela de detalhe com parcelas e histórico de pagamentos.
- Exportação/importação de backup em JSON e exportação em CSV (empréstimos e pagamentos).
- Senha simples para abrir o app.

## Regras de cálculo

- **Lucro real** = recebido − emprestado, somando apenas empréstimos quitados ou cujo capital já foi recuperado (recebido ≥ emprestado). Se houver calotes, o painel mostra também o valor descontando as perdas.
- **Lucro previsto** = total a receber − total emprestado (empréstimos que não são calote).
- **Total perdido** = valor emprestado − valor já recebido dos empréstimos marcados como calote.
- **Em atraso** = parte não paga das parcelas com vencimento anterior a hoje. Os pagamentos são abatidos das parcelas em ordem de vencimento.
- A senha só impede o acesso pela tela do app; os dados não são criptografados.
