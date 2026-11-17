/** Valida CPF (dígitos verificadores). Retorna os 11 dígitos ou null. */
function normalizeCpf(input) {
  const d = String(input ?? '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  for (const n of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    const dv = ((sum * 10) % 11) % 10;
    if (dv !== Number(d[n])) return null;
  }
  return d;
}

const maskCpf = (d) => `***.***.***-${d.slice(-2)}`;

module.exports = { normalizeCpf, maskCpf };
