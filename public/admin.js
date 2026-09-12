document.addEventListener('DOMContentLoaded', () => {
    const listaReservas = document.getElementById('lista-reservas');
    const adminStatus = document.getElementById('admin-status');

    async function carregarReservas() {
        try {
            adminStatus.textContent = 'Consultando o mapa de reservas...';
            
            // Endpoint preparado para o backend
            const response = await fetch('/api/reservas');
            
            if (!response.ok) {
                // Caso API não esteja pronta
                simularDados();
                return;
            }

            const reservas = await response.json();
            renderizarReservas(reservas);
            adminStatus.textContent = '';
        } catch (error) {
            console.error('Erro ao carregar reservas:', error);
            // Fallback simulado para preview
            simularDados();
        }
    }

    function simularDados() {
        const dadosSimulados = [
            { id: 1, created_at: '2026-09-06 10:30', nome: 'Jack Sparrow', whatsapp: '11999999999', roteiro: 'Rota da Caveira', data_passeio: '2026-09-10' },
            { id: 2, created_at: '2026-09-06 14:15', nome: 'Anne Bonny', whatsapp: '21988888888', roteiro: 'Aventura Oceânica', data_passeio: '2026-09-12' }
        ];
        renderizarReservas(dadosSimulados);
        adminStatus.textContent = 'Aviso: API offline. Exibindo dados de simulação na cabine do capitão.';
        adminStatus.className = 'status-msg error';
    }

    function renderizarReservas(reservas) {
        listaReservas.innerHTML = '';
        
        if (reservas.length === 0) {
            listaReservas.innerHTML = '<tr><td colspan="6" style="text-align: center;">Nenhum alistamento pendente.</td></tr>';
            return;
        }

        reservas.forEach(reserva => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${reserva.created_at || '-'}</td>
                <td>${reserva.nome}</td>
                <td>${reserva.whatsapp}</td>
                <td>${reserva.roteiro}</td>
                <td>${reserva.data_passeio}</td>
                <td>
                    <button class="btn-brass btn-small" onclick="aprovarReserva(${reserva.id})">Aprovar</button>
                    <button class="btn-brass btn-small" onclick="rejeitarReserva(${reserva.id})" style="background-color: #8a1c1c; color: white;">Rejeitar</button>
                </td>
            `;
            listaReservas.appendChild(tr);
        });
    }

    window.aprovarReserva = async (id) => {
        try {
            // Lógica real de aprovação: fetch(`/api/reservas/${id}/aprovar`, { method: 'POST' })
            alert(`Reserva ${id} aprovada! (Preparado para API)`);
            // await fetch(`/api/reservas/${id}/aprovar`, { method: 'POST' });
            // carregarReservas();
        } catch (error) {
            console.error(error);
        }
    };

    window.rejeitarReserva = async (id) => {
        if(confirm(`Tem certeza que deseja mandar a reserva ${id} para a prancha?`)) {
            try {
                // Lógica real: fetch(`/api/reservas/${id}/rejeitar`, { method: 'POST' })
                alert(`Reserva ${id} rejeitada! (Preparado para API)`);
                // await fetch(`/api/reservas/${id}/rejeitar`, { method: 'POST' });
                // carregarReservas();
            } catch (error) {
                console.error(error);
            }
        }
    };

    carregarReservas();
});
