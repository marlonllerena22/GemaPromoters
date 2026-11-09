// Browser-only sandbox for the private design preview. No operational API,
// provider credentials, real uploads, bank transfers or WhatsApp sends exist.
(() => {
  if (location.pathname === "/") {
    location.replace("/finanzas/");
    return;
  }
  const originalFetch = window.fetch.bind(window),
    clone = (value) => JSON.parse(JSON.stringify(value));
  let persona = "owner",
    baseline;
  const fixture = originalFetch("/demo-data.json", { cache: "no-store" }).then(
    async (response) => {
      if (!response.ok) throw new Error("No se pudo cargar el ejemplo");
      const data = await response.json();
      baseline = clone(data.workflow_source);
      return data;
    }
  );
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  const forbidden = () =>
    json(
      {
        message:
          "Esta acción no está habilitada en la demostración. Usa únicamente datos de ejemplo.",
      },
      403
    );
  window.fetch = async (input, options = {}) => {
    const url = new URL(
      typeof input === "string" ? input : input.url,
      location.href
    );
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/"))
      return originalFetch(input, options);
    try {
      const data = await fixture,
        user = data.personas[persona],
        method = String(options.method || input.method || "GET").toUpperCase();
      const body = options.body ? JSON.parse(options.body) : {};
      const {
        workflowView,
        canSeeSpace,
        canSeePaymentRequest,
        paymentProgress,
      } = await import("/workflow.mjs");
      const source = data.workflow_source,
        w = () => workflowView(source, user),
        period = data.snapshots.all.period;
      const owner = user.role === "owner",
        business = url.searchParams.get("business_id") || "all";
      const requestById = (id) => {
        const r = source.requests.find((r) => r.id === Number(id));
        return r && canSeePaymentRequest(r, user, source.spaces, source.members)
          ? { ...r, ...paymentProgress(r, source.payments) }
          : null;
      };
      if (
        url.pathname === "/api/finance/preview/persona" &&
        method === "POST"
      ) {
        const next = body.role === "collector" ? "norma" : body.role;
        if (!data.personas[next])
          return json({ message: "Perfil no disponible" }, 400);
        persona = next;
        return json({ user: data.personas[persona] });
      }
      if (url.pathname === "/api/finance/session" && method === "GET")
        return json({
          user,
          configured: false,
          demo: true,
          public_preview: true,
          period,
        });
      if (url.pathname === "/api/finance/demo" && method === "POST")
        return json({ user });
      if (url.pathname === "/api/finance/logout" && method === "POST")
        return json({ ok: true });
      if (url.pathname === "/api/finance/snapshot" && method === "GET") {
        const base = data.persona_snapshots[persona]?.[business];
        if (!base) return forbidden();
        const result = clone(base),
          workflow = w(),
          previous = workflowView(baseline, user);
        const belongs = (r) => business === "all" || r.business_id === business;
        result.workflow = workflow;
        result.settlement_funds =
          user.role !== "collector" &&
          result.businesses.some((b) => b.id === "marjorie")
            ? clone(source.settlements || [])
            : [];
        result.summary.pending_cents +=
          workflow.queue
            .filter(belongs)
            .reduce((s, r) => s + r.remaining_cents, 0) -
          previous.queue
            .filter(belongs)
            .reduce((s, r) => s + r.remaining_cents, 0);
        const totalPaid = (payments, requests) =>
          payments
            .filter(
              (p) =>
                !p.voided_at &&
                belongs(requests.find((r) => r.id === p.request_id) || {})
            )
            .reduce((s, p) => s + p.amount_cents, 0);
        result.summary.expense_cents +=
          totalPaid(workflow.payments, workflow.requests) -
          totalPaid(previous.payments, previous.requests);
        const newRequests = workflow.requests.filter(
          (r) =>
            r.simulated &&
            belongs(r) &&
            (user.role !== "collector" || r.created_by === user.username)
        );
        result.movements = [...newRequests, ...result.movements];
        result.movements_total += newRequests.length;
        result.preview_personas = data.snapshots.all.preview_personas;
        result.generated_at = new Date().toISOString();
        return json(result);
      }
      if (url.pathname === "/api/finance/spaces" && method === "GET")
        return json(w());
      if (url.pathname === "/api/finance/members" && method === "GET")
        return owner ? json({ members: data.members }) : forbidden();
      if (url.pathname === "/api/finance/orders" && method === "GET")
        return json({ orders: [] });
      if (url.pathname === "/api/finance/push/config" && method === "GET")
        return json({ enabled: false, public_key: null });
      if (
        url.pathname === "/api/finance/settlement-funds/diners" &&
        method === "POST"
      ) {
        if (!owner) return forbidden();
        if (
          ![body.available_cents, body.pending_cents].every(
            (n) => Number.isSafeInteger(n) && n >= 0
          ) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.as_of) ||
          body.as_of > period.today
        )
          return json({ message: "Revisa los saldos y la fecha" }, 400);
        source.settlements = [
          {
            provider: "diners",
            business_id: "marjorie",
            available_cents: body.available_cents,
            pending_cents: body.pending_cents,
            as_of: body.as_of,
            updated_at: new Date().toISOString(),
            updated_by: user.username,
          },
        ];
        return json({ ok: true, preview: true });
      }
      if (url.pathname === "/api/finance/payees") {
        if (user.role === "viewer") return forbidden();
        const b =
            method === "GET"
              ? url.searchParams.get("business_id")
              : body.business_id,
          s =
            method === "GET"
              ? url.searchParams.get("space_id") || null
              : body.space_id || null;
        const space = s ? source.spaces.find((x) => x.id === s) : null;
        if (
          !user.business_ids.includes(b) ||
          (s &&
            (!space ||
              !canSeeSpace(space, user, source.members) ||
              (!owner &&
                source.members.find(
                  (m) => m.space_id === s && m.member_id === user.id
                )?.role === "observer")))
        )
          return forbidden();
        const contacts = (source.contacts || []).filter(
          (c) =>
            c.business_id === b &&
            (c.space_id || null) === s &&
            (owner || s || c.created_by === user.username)
        );
        if (method === "GET") return json({ contacts });
        const { normalizePayee, payeeError } = await import("/payees.mjs");
        const p = normalizePayee(body),
          error = payeeError(p);
        if (error) return json({ message: error }, 400);
        const previous = contacts.find((c) =>
          c.accounts.some((a) =>
            p.accounts.some(
              (x) =>
                x.bank.toLowerCase() === a.bank.toLowerCase() &&
                x.number === a.number
            )
          )
        );
        if (previous) {
          if (previous.name !== p.name)
            return json(
              {
                message:
                  "La cuenta ya está guardada. Selecciona el contacto existente.",
              },
              409
            );
          return json({ contact: previous, duplicate: true, preview: true });
        }
        const contact = {
          ...p,
          id: crypto.randomUUID(),
          business_id: b,
          space_id: s,
          created_by: user.username,
        };
        (source.contacts ||= []).push(contact);
        return json({ contact, preview: true }, 201);
      }
      if (
        url.pathname === "/api/finance/payment-requests" &&
        method === "POST"
      ) {
        const c = source.contacts.find((c) => c.id === body.contact_id);
        if (
          !c ||
          c.business_id !== body.business_id ||
          c.space_id !== (body.space_id || null) ||
          user.role === "viewer"
        )
          return forbidden();
        const result = await window.fetch("/api/finance/quick/register", {
          method: "POST",
          body: JSON.stringify({
            request_id: body.request_id,
            request: true,
            text: body.description || "Pago solicitado",
            space_id: body.space_id,
            evidence_id: body.evidence_id,
            overrides: {
              kind: "expense",
              amount_cents: body.amount_cents,
              business_id: body.business_id,
              unit_id: body.unit_id,
              counterparty: c.name,
              payment_method: "transfer",
              category: body.category || "Otros",
            },
          }),
        });
        if (!result.ok) return result;
        const saved = await result.json();
        source.beneficiaries[saved.movement.id] = {
          name: c.name,
          document: c.document,
          email: c.email,
          accounts: clone(c.accounts),
          contact_id: c.id,
        };
        return json(saved, 201);
      }
      const receipt = url.pathname.match(
        /^\/api\/finance\/(payments|payment-requests)\/(\d+)\/evidence$/
      );
      if (receipt && method === "GET") {
        const payment =
          receipt[1] === "payments"
            ? source.payments.find((p) => p.id === Number(receipt[2]))
            : null;
        const request = requestById(payment?.request_id || receipt[2]);
        if (!request || (receipt[1] === "payments" && !payment))
          return forbidden();
        const total = (
          (payment?.amount_cents || request.amount_cents) / 100
        ).toFixed(2);
        const suffix = String(
          source.beneficiaries?.[request.id]?.accounts?.[
            payment?.destination_index
          ]?.number || "5678"
        )
          .slice(-4)
          .replace(/[^A-Z0-9]/g, "");
        return new Response(
          `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="940" viewBox="0 0 680 940"><rect width="680" height="940" fill="#edf3e7"/><rect x="32" y="32" width="616" height="876" rx="30" fill="white"/><text x="340" y="110" text-anchor="middle" font-family="Arial" font-size="22" fill="#41614b">GEMA · COMPROBANTE FICTICIO</text><circle cx="340" cy="210" r="50" fill="#e8f1de"/><text x="340" y="229" text-anchor="middle" font-family="Arial" font-size="50" fill="#517646">✓</text><text x="340" y="335" text-anchor="middle" font-family="Arial" font-size="58" fill="#244b39">$ ${total}</text><text x="340" y="410" text-anchor="middle" font-family="Arial" font-size="25" fill="#41614b">Transferencia de ejemplo</text><path d="M90 455H590" stroke="#dce5d5"/><text x="90" y="520" font-family="Arial" font-size="22" fill="#5b705c">Destino: Contacto de demostración</text><text x="90" y="575" font-family="Arial" font-size="22" fill="#5b705c">Cuenta ficticia: ···· ${suffix}</text><text x="90" y="630" font-family="Arial" font-size="22" fill="#5b705c">Referencia: EJEMPLO-SIN-VALIDEZ</text><text x="340" y="755" text-anchor="middle" font-family="Arial" font-size="31" fill="#a58140">SIN VALIDEZ BANCARIA</text><text x="340" y="805" text-anchor="middle" font-family="Arial" font-size="19" fill="#73806a">No acredita ni realiza un pago.</text></svg>`,
          {
            headers: {
              "Content-Type": "image/svg+xml",
              "Cache-Control": "no-store",
            },
          }
        );
      }
      if (url.pathname === "/api/finance/quick/register" && method === "POST") {
        if (user.role === "viewer") return forbidden();
        const { interpretQuickEntry } = await import("/quick-intent.mjs");
        const context = data.persona_snapshots[persona].all;
        const result = interpretQuickEntry(body.text, {
          ...user,
          units: context.units,
          accounts: context.accounts,
          day: period.today,
          overrides: body.overrides,
          request: body.request,
        });
        if (!result.ready)
          return json(
            { message: result.error || "Completa los datos del resumen" },
            400
          );
        if (body.space_id) {
          const s = source.spaces.find((s) => s.id === body.space_id);
          if (
            !s ||
            !canSeeSpace(s, user, source.members) ||
            !s.business_ids.includes(result.draft.business_id)
          )
            return forbidden();
        }
        const movement = {
          ...result.draft,
          id: Date.now(),
          created_by: user.username,
          requester_name: user.name,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status:
            user.role === "collector" ||
            result.is_request ||
            result.draft.kind === "income"
              ? "pending"
              : "reported",
          is_payment_request: result.is_request ? 1 : 0,
          space_id: body.space_id || null,
          simulated: true,
        };
        if (result.is_request) source.requests.unshift(movement);
        return json(
          { preview: true, workflow_changed: result.is_request, movement },
          201
        );
      }
      const detail = url.pathname.match(
        /^\/api\/finance\/payment-requests\/(\d+)$/
      );
      if (detail && method === "GET") {
        const request = requestById(detail[1]);
        if (!request) return forbidden();
        return json({
          request,
          beneficiary: source.beneficiaries?.[request.id] || null,
          space: source.spaces.find((s) => s.id === request.space_id) || null,
          payments: source.payments.filter((p) => p.request_id === request.id),
          notes: (source.notes || []).filter(
            (n) => n.request_id === request.id
          ),
        });
      }
      const pay = url.pathname.match(
        /^\/api\/finance\/payment-requests\/(\d+)\/payments$/
      );
      if (pay && method === "POST") {
        if (!owner) return forbidden();
        const request = requestById(pay[1]);
        if (!request) return forbidden();
        const beneficiary = source.beneficiaries?.[request.id];
        if (
          beneficiary &&
          (!Number.isInteger(body.destination_index) ||
            !beneficiary.accounts[body.destination_index])
        )
          return json(
            { message: "Elige la cuenta de destino que utilizaste" },
            400
          );
        if (
          !body.confirm_paid ||
          !body.evidence_id ||
          !body.reference ||
          !Number.isSafeInteger(body.amount_cents) ||
          body.amount_cents <= 0 ||
          body.amount_cents > request.remaining_cents
        )
          return json(
            {
              message: "Revisa el monto, referencia y comprobante del ejemplo",
            },
            400
          );
        const previous = source.payments.find(
          (p) => p.request_key === body.request_key
        );
        if (previous)
          return json({
            preview: true,
            payment: previous,
            duplicate: true,
            remaining_cents: request.remaining_cents,
          });
        const account = data.snapshots.all.accounts.find(
          (a) => a.id === Number(body.account_id)
        );
        if (
          !account ||
          (account.business_id && account.business_id !== request.business_id)
        )
          return json({ message: "La cuenta no corresponde al negocio" }, 400);
        const payment = {
          id: Date.now(),
          request_id: request.id,
          movement_id: Date.now() + 1,
          amount_cents: body.amount_cents,
          evidence_id: -1,
          account_id: account.id,
          destination_index: body.destination_index ?? null,
          destination_bank:
            beneficiary?.accounts?.[body.destination_index]?.bank || null,
          destination_last_four:
            beneficiary?.accounts?.[body.destination_index]?.number.slice(-4) ||
            null,
          account_bank: account.bank,
          last_four: account.last_four,
          paid_day: body.paid_day,
          reference: body.reference,
          created_by: user.username,
          payer_name: user.name,
          evidence_name: "Comprobante ficticio · demostración",
          verification_status: "reported",
          created_at: new Date().toISOString(),
          request_key: body.request_key,
          simulated: true,
        };
        source.payments.unshift(payment);
        const progress = paymentProgress(request, source.payments);
        if (!progress.remaining_cents)
          source.requests.find((r) => r.id === request.id).status = "reported";
        return json(
          { preview: true, payment, remaining_cents: progress.remaining_cents },
          201
        );
      }
      const cancel = url.pathname.match(
        /^\/api\/finance\/payment-requests\/(\d+)\/cancel$/
      );
      if (cancel && method === "POST") {
        if (!owner) return forbidden();
        const request = requestById(cancel[1]);
        if (!request || !String(body.reason || "").trim())
          return json({ message: "Indica un motivo" }, 400);
        const row = source.requests.find((r) => r.id === request.id);
        row.status = "rejected";
        row.review_note = body.reason;
        return json({ preview: true, ok: true });
      }
      const note = url.pathname.match(
        /^\/api\/finance\/payment-requests\/(\d+)\/notes$/
      );
      if (note && method === "POST") {
        if (user.role === "viewer") return forbidden();
        const request = requestById(note[1]);
        if (!request || !String(body.body || "").trim())
          return json({ message: "Escribe una nota" }, 400);
        source.notes.push({
          id: Date.now(),
          request_id: request.id,
          actor: user.username,
          actor_name: user.name,
          body: String(body.body).slice(0, 1000),
          created_at: new Date().toISOString(),
        });
        return json({ preview: true, ok: true }, 201);
      }
      if (url.pathname === "/api/finance/spaces" && method === "POST") {
        if (!owner) return forbidden();
        if (
          !String(body.name || "").trim() ||
          !Array.isArray(body.business_ids) ||
          body.business_ids.some((b) => !user.business_ids.includes(b))
        )
          return json({ message: "Revisa el nombre y los negocios" }, 400);
        const id = crypto.randomUUID();
        source.spaces.push({
          id,
          name: body.name,
          kind: body.kind,
          business_ids: body.business_ids,
          description: "Espacio de ejemplo",
          suggested_members: [],
          active: 1,
          share_type: "group",
          share_label: body.name,
          share_phone: "",
        });
        return json({ id, preview: true }, 201);
      }
      const settings = url.pathname.match(
        /^\/api\/finance\/spaces\/([^/]+)\/settings$/
      );
      if (settings && method === "POST") {
        if (!owner) return forbidden();
        const space = source.spaces.find((s) => s.id === settings[1]);
        if (!space) return forbidden();
        for (const key of ["name", "share_type", "share_label", "share_phone"])
          if (body[key] !== undefined) space[key] = String(body[key]);
        if (body.members) {
          source.members = source.members.filter(
            (m) => m.space_id !== space.id
          );
          for (const member of body.members) {
            const person = data.members.find((m) => m.id === member.member_id);
            if (person)
              source.members.push({
                space_id: space.id,
                member_id: person.id,
                name: person.name,
                role: member.role,
              });
          }
        }
        return json({ preview: true, ok: true });
      }
      if (url.pathname === "/api/finance/export" && method === "GET") {
        if (user.role === "collector") return forbidden();
        const value =
          persona === "owner"
            ? data.exports[business] || data.exports.all
            : "business_id,amount_usd\r\n";
        return new Response(value, { headers: { "Content-Type": "text/csv" } });
      }
      if (url.pathname === "/api/finance/assistant" && method === "POST") {
        if (user.role === "collector") return forbidden();
        const report =
          data.persona_snapshots[persona][body.filters?.business_id || "all"] ||
          data.persona_snapshots[persona].all;
        const usd = (n) =>
          new Intl.NumberFormat("es-EC", {
            style: "currency",
            currency: "USD",
          }).format((n || 0) / 100);
        return json({
          mode: "data",
          movement_ids: [],
          answer:
            "Soy Gema. Esta vista contiene datos ficticios y no tiene IA conversacional conectada.\n\n" +
            report.businesses
              .map((b) => `${b.name}: fondos atribuidos ${usd(b.funds_cents)}`)
              .join("\n") +
            `\n\nHay ${
              w().summary.pending_count
            } solicitudes por transferir en los espacios visibles. Los detalles personales no están incluidos en los perfiles de trabajo.`,
        });
      }
      return forbidden();
    } catch (error) {
      return json(
        { message: error.message || "No se pudo completar el ejemplo" },
        400
      );
    }
  };
})();
