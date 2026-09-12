document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-reserva');
    const statusMsg = document.getElementById('form-status');
    const pixArea = document.getElementById('pix-area');
    const pixQrcode = document.getElementById('pix-qrcode');
    const pixCopiacola = document.getElementById('pix-copiacola');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = {
                nome: document.getElementById('nome').value,
                whatsapp: document.getElementById('whatsapp').value,
                roteiro_id: document.getElementById('roteiro').value,
                data_passeio: document.getElementById('data_passeio').value,
                num_pessoas: parseInt(document.getElementById('num_pessoas').value, 10)
            };

            statusMsg.textContent = 'Enviando mensagem na garrafa...';
            statusMsg.className = 'status-msg';

            try {
                const response = await fetch('/api/reservas', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                const data = await response.json();

                if (response.ok && data.sucesso) {
                    statusMsg.textContent = 'Alistamento registrado! Efetue o pagamento abaixo.';
                    statusMsg.className = 'status-msg success';
                    
                    // Exibir o QR Code e o Copia/Cola
                    pixQrcode.src = data.pixBase64;
                    pixCopiacola.value = data.pixPayload;
                    pixArea.style.display = 'block';
                    
                    form.reset();
                    // Ocultar formulário ou desabilitar botão pode ser bom
                    form.querySelector('button').disabled = true;
                } else {
                    throw new Error(data.error || 'Falha ao enviar reserva.');
                }
            } catch (error) {
                console.error('Erro:', error);
                statusMsg.textContent = error.message || 'Um monstro marinho interceptou sua mensagem. Tente novamente!';
                statusMsg.className = 'status-msg error';
            }
        });
    }
});
