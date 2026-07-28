export function initProducalzaDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'vendor' CHECK (role IN ('admin', 'vendor')),
      can_view_all_orders INTEGER NOT NULL DEFAULT 0 CHECK (can_view_all_orders IN (0, 1)),
      is_local_secretary INTEGER NOT NULL DEFAULT 0 CHECK (is_local_secretary IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS production_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      external_number INTEGER,
      name TEXT NOT NULL,
      business_name TEXT,
      tax_id TEXT,
      city TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      brand TEXT,
      payment_method TEXT,
      bank_reference TEXT,
      classification TEXT,
      imported_seller_code TEXT,
      local_store_key TEXT,
      guide_template_key TEXT,
      guide_logo_url TEXT,
      general_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, external_number)
    );

    CREATE TABLE IF NOT EXISTS production_client_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      visited_by_user_id INTEGER,
      visitor_name TEXT,
      visit_type TEXT NOT NULL DEFAULT 'visit',
      result TEXT,
      next_visit_date TEXT,
      next_visit_type TEXT,
      order_id INTEGER,
      visit_date TEXT,
      visit_date_text TEXT,
      pairs INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (client_id) REFERENCES production_clients(id),
      FOREIGN KEY (visited_by_user_id) REFERENCES production_users(id),
      FOREIGN KEY (order_id) REFERENCES production_orders(id)
    );

    CREATE TABLE IF NOT EXISTS production_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_type TEXT NOT NULL DEFAULT 'order' CHECK (order_type IN ('order', 'return')),
      is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
      parent_order_id INTEGER,
      order_number TEXT,
      client_id INTEGER NOT NULL,
      seller_user_id INTEGER,
      order_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      delivery_date TEXT,
      origin_label TEXT,
      card_alert TEXT,
      brand TEXT,
      payment_method TEXT,
      bank_reference TEXT,
      guide_template_key TEXT,
      sample_destination TEXT,
      general_notes TEXT,
      dispatched_date TEXT,
      shipping_value REAL NOT NULL DEFAULT 0,
      discount_value REAL NOT NULL DEFAULT 0,
      invoice_number TEXT,
      invoice_date TEXT,
      invoice_value REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'received', 'reviewed', 'in_production', 'finished', 'delivered', 'cancelled')),
      created_by TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (parent_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (client_id) REFERENCES production_clients(id),
      FOREIGN KEY (seller_user_id) REFERENCES production_users(id),
      UNIQUE(establishment_id, order_number)
    );

    CREATE TABLE IF NOT EXISTS production_order_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      card_number INTEGER,
      model_code TEXT NOT NULL,
      color TEXT,
      material TEXT,
      notes TEXT,
      plant_area TEXT,
      total_pairs INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'reviewed', 'in_production', 'cut', 'stitched', 'assembled', 'finished', 'delivered', 'cancelled')),
      process_cut INTEGER NOT NULL DEFAULT 0 CHECK (process_cut IN (0, 1)),
      process_prepared INTEGER NOT NULL DEFAULT 0 CHECK (process_prepared IN (0, 1)),
      process_stitched INTEGER NOT NULL DEFAULT 0 CHECK (process_stitched IN (0, 1)),
      process_assembled INTEGER NOT NULL DEFAULT 0 CHECK (process_assembled IN (0, 1)),
      process_planted INTEGER NOT NULL DEFAULT 0 CHECK (process_planted IN (0, 1)),
      process_finished INTEGER NOT NULL DEFAULT 0 CHECK (process_finished IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (order_id) REFERENCES production_orders(id),
      UNIQUE(establishment_id, card_number)
    );

    CREATE TABLE IF NOT EXISTS production_model_sizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      model_id INTEGER NOT NULL,
      size INTEGER NOT NULL CHECK (size BETWEEN 20 AND 50),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (model_id) REFERENCES production_order_models(id),
      UNIQUE(model_id, size)
    );

    CREATE TABLE IF NOT EXISTS production_order_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      payment_type TEXT NOT NULL DEFAULT 'abono'
        CHECK (payment_type IN ('abono', 'cheque', 'transferencia', 'efectivo', 'saldo', 'otro')),
      amount REAL NOT NULL DEFAULT 0,
      payment_date TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
      bank TEXT,
      reference TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (order_id) REFERENCES production_orders(id)
    );

    CREATE TABLE IF NOT EXISTS production_delivery_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      note_number INTEGER NOT NULL DEFAULT 1,
      note_type TEXT NOT NULL DEFAULT 'sent' CHECK (note_type IN ('sent', 'pending')),
      title TEXT,
      destination TEXT,
      model_ids_json TEXT NOT NULL DEFAULT '[]',
      model_prices_json TEXT NOT NULL DEFAULT '{}',
      shipping_value REAL NOT NULL DEFAULT 0,
      discount_value REAL NOT NULL DEFAULT 0,
      total_value REAL NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (order_id) REFERENCES production_orders(id)
    );

    CREATE TABLE IF NOT EXISTS production_remission_guides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      guide_number INTEGER NOT NULL,
      format_type TEXT NOT NULL DEFAULT 'producalza',
      issue_date TEXT NOT NULL,
      departure_place TEXT,
      arrival_place TEXT,
      recipient_name TEXT,
      recipient_business_name TEXT,
      recipient_tax_id TEXT,
      sale_receipt TEXT,
      departure_time TEXT,
      arrival_time TEXT,
      transfer_reason TEXT NOT NULL DEFAULT 'VENTA',
      carrier_identification TEXT,
      description TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (order_id) REFERENCES production_orders(id),
      UNIQUE(establishment_id, guide_number)
    );

    CREATE TABLE IF NOT EXISTS production_return_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      return_order_id INTEGER NOT NULL,
      return_model_id INTEGER NOT NULL,
      source_order_id INTEGER,
      source_model_id INTEGER,
      size INTEGER NOT NULL CHECK (size BETWEEN 20 AND 50),
      destination TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (return_order_id) REFERENCES production_orders(id),
      FOREIGN KEY (return_model_id) REFERENCES production_order_models(id)
    );

    CREATE TABLE IF NOT EXISTS production_settings (
      establishment_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (establishment_id, key),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS production_guide_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      template_key TEXT NOT NULL,
      name TEXT NOT NULL,
      logo_url TEXT NOT NULL,
      custom_layout INTEGER NOT NULL DEFAULT 0 CHECK (custom_layout IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, template_key)
    );

    CREATE TABLE IF NOT EXISTS production_monthly_report_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      source_key TEXT NOT NULL,
      report_month TEXT NOT NULL,
      entry_date TEXT,
      client_name TEXT NOT NULL,
      entered_pairs INTEGER,
      observations TEXT,
      dispatched_pairs INTEGER,
      dispatched_date TEXT,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, source_key)
    );

    CREATE TABLE IF NOT EXISTS production_employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      source_name TEXT,
      pay_type TEXT NOT NULL DEFAULT 'salary' CHECK (pay_type IN ('salary', 'piecework')),
      monthly_salary REAL NOT NULL DEFAULT 0,
      default_iess REAL NOT NULL DEFAULT 0,
      late_penalty REAL NOT NULL DEFAULT 5,
      normal_start TEXT NOT NULL DEFAULT '08:00',
      normal_end TEXT NOT NULL DEFAULT '16:30',
      grace_minutes INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, name)
    );

    CREATE TABLE IF NOT EXISTS production_payroll_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      source_filename TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'closed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      UNIQUE(establishment_id, label)
    );

    CREATE TABLE IF NOT EXISTS production_payroll_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      period_id INTEGER NOT NULL,
      employee_id INTEGER,
      employee_name TEXT NOT NULL,
      source_name TEXT,
      pay_type TEXT NOT NULL DEFAULT 'salary',
      monthly_salary REAL NOT NULL DEFAULT 0,
      hourly_rate REAL NOT NULL DEFAULT 0,
      overtime_rate REAL NOT NULL DEFAULT 0,
      overtime_50_hours REAL NOT NULL DEFAULT 0,
      overtime_100_hours REAL NOT NULL DEFAULT 0,
      overtime_100_rate REAL NOT NULL DEFAULT 0,
      work_days INTEGER NOT NULL DEFAULT 0,
      attendance_days INTEGER NOT NULL DEFAULT 0,
      absent_days INTEGER NOT NULL DEFAULT 0,
      late_days INTEGER NOT NULL DEFAULT 0,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      justify_late INTEGER NOT NULL DEFAULT 0,
      justify_absence INTEGER NOT NULL DEFAULT 0,
      early_leave_days INTEGER NOT NULL DEFAULT 0,
      overtime_hours REAL NOT NULL DEFAULT 0,
      manual_unworked_hours REAL NOT NULL DEFAULT 0,
      late_penalty REAL NOT NULL DEFAULT 0,
      iess_amount REAL NOT NULL DEFAULT 0,
      advance_amount REAL NOT NULL DEFAULT 0,
      savings_amount REAL NOT NULL DEFAULT 0,
      footwear_amount REAL NOT NULL DEFAULT 0,
      loan_amount REAL NOT NULL DEFAULT 0,
      other_deductions REAL NOT NULL DEFAULT 0,
      other_income REAL NOT NULL DEFAULT 0,
      piece_income REAL NOT NULL DEFAULT 0,
      total_income REAL NOT NULL DEFAULT 0,
      total_deductions REAL NOT NULL DEFAULT 0,
      net_pay REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (period_id) REFERENCES production_payroll_periods(id),
      FOREIGN KEY (employee_id) REFERENCES production_employees(id),
      UNIQUE(establishment_id, period_id, employee_name)
    );

    CREATE TABLE IF NOT EXISTS production_local_finances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      local_name TEXT NOT NULL,
      entry_type TEXT NOT NULL DEFAULT 'income' CHECK (entry_type IN ('income', 'expense')),
      finance_group TEXT NOT NULL DEFAULT 'various',
      category TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      entry_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      payee TEXT,
      pairs INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (created_by_user_id) REFERENCES production_users(id)
    );

    CREATE TABLE IF NOT EXISTS production_local_daily_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      sale_number TEXT,
      local_name TEXT NOT NULL,
      model_code TEXT NOT NULL,
      color TEXT,
      size TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      sale_kind TEXT NOT NULL DEFAULT 'normal' CHECK (sale_kind IN ('normal', 'separated', 'wholesale')),
      seller_name TEXT,
      payment_method TEXT NOT NULL DEFAULT 'efectivo' CHECK (payment_method IN ('efectivo', 'transferencia', 'tarjeta')),
      amount REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      sale_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      notes TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (created_by_user_id) REFERENCES production_users(id),
      UNIQUE(establishment_id, sale_number)
    );

    CREATE TABLE IF NOT EXISTS production_local_staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      allowed_locations_json TEXT NOT NULL DEFAULT '[]',
      default_location TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE TABLE IF NOT EXISTS production_local_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      staff_id INTEGER NOT NULL,
      staff_name TEXT NOT NULL,
      location TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('in', 'out')),
      local_date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
      local_time TEXT NOT NULL DEFAULT (time('now', 'localtime')),
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (staff_id) REFERENCES production_local_staff(id)
    );

    CREATE TABLE IF NOT EXISTS production_local_monthly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      local_name TEXT NOT NULL,
      report_month TEXT NOT NULL,
      cash_pairs INTEGER NOT NULL DEFAULT 0,
      cash_value REAL NOT NULL DEFAULT 0,
      card_pairs INTEGER NOT NULL DEFAULT 0,
      card_value REAL NOT NULL DEFAULT 0,
      separated_pairs INTEGER NOT NULL DEFAULT 0,
      separated_value REAL NOT NULL DEFAULT 0,
      wholesale_pairs INTEGER NOT NULL DEFAULT 0,
      wholesale_value REAL NOT NULL DEFAULT 0,
      business_pairs INTEGER NOT NULL DEFAULT 0,
      business_value REAL NOT NULL DEFAULT 0,
      previous_balance REAL NOT NULL DEFAULT 0,
      card_note TEXT,
      notes TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (created_by_user_id) REFERENCES production_users(id),
      UNIQUE(establishment_id, local_name, report_month)
    );

    CREATE TABLE IF NOT EXISTS production_local_monthly_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      report_id INTEGER NOT NULL,
      section TEXT NOT NULL CHECK (section IN ('expense', 'service', 'deposit')),
      label TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (report_id) REFERENCES production_local_monthly_reports(id)
    );

    CREATE TABLE IF NOT EXISTS production_local_payroll_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      local_name TEXT NOT NULL,
      report_month TEXT NOT NULL,
      staff_id INTEGER,
      staff_name TEXT NOT NULL,
      date_from TEXT,
      date_to TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (staff_id) REFERENCES production_local_staff(id),
      UNIQUE(establishment_id, local_name, report_month, staff_name)
    );

    CREATE TABLE IF NOT EXISTS production_local_payroll_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      payroll_id INTEGER NOT NULL,
      item_type TEXT NOT NULL CHECK (item_type IN ('income', 'deduction')),
      label TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id),
      FOREIGN KEY (payroll_id) REFERENCES production_local_payroll_cards(id)
    );

    CREATE TABLE IF NOT EXISTS production_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      establishment_id INTEGER NOT NULL,
      user_label TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (establishment_id) REFERENCES establishments(id)
    );

    CREATE INDEX IF NOT EXISTS idx_production_clients_business
      ON production_clients(establishment_id, name);
    CREATE INDEX IF NOT EXISTS idx_production_orders_business
      ON production_orders(establishment_id, order_date, status);
    CREATE INDEX IF NOT EXISTS idx_production_models_order
      ON production_order_models(order_id, status);
    CREATE INDEX IF NOT EXISTS idx_production_monthly_rows_business
      ON production_monthly_report_rows(establishment_id, report_month, entry_date, dispatched_date);
    CREATE INDEX IF NOT EXISTS idx_production_order_payments_business
      ON production_order_payments(establishment_id, due_date, status);
    CREATE INDEX IF NOT EXISTS idx_production_delivery_notes_order
      ON production_delivery_notes(establishment_id, order_id, note_number);
    CREATE INDEX IF NOT EXISTS idx_production_remission_guides_order
      ON production_remission_guides(establishment_id, order_id, guide_number);
    CREATE INDEX IF NOT EXISTS idx_production_return_allocations_order
      ON production_return_allocations(establishment_id, return_order_id, destination);
    CREATE INDEX IF NOT EXISTS idx_production_payroll_entries_period
      ON production_payroll_entries(establishment_id, period_id, employee_name);
    CREATE INDEX IF NOT EXISTS idx_production_local_finances_business
      ON production_local_finances(establishment_id, entry_date, local_name);
    CREATE INDEX IF NOT EXISTS idx_production_local_daily_sales_business
      ON production_local_daily_sales(establishment_id, sale_date, local_name);
    CREATE INDEX IF NOT EXISTS idx_production_local_attendance_business
      ON production_local_attendance(establishment_id, local_date, staff_id);
    CREATE INDEX IF NOT EXISTS idx_production_local_monthly_reports_business
      ON production_local_monthly_reports(establishment_id, report_month, local_name);
    CREATE INDEX IF NOT EXISTS idx_production_local_payroll_business
      ON production_local_payroll_cards(establishment_id, report_month, local_name);
  `);

  addColumnIfMissing(db, 'production_users', 'is_local_secretary', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_local_finances', 'finance_group', "TEXT NOT NULL DEFAULT 'various'");
  addColumnIfMissing(db, 'production_local_finances', 'payee', 'TEXT');
  addColumnIfMissing(db, 'production_local_finances', 'pairs', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_local_daily_sales', 'quantity', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'production_local_daily_sales', 'sale_kind', "TEXT NOT NULL DEFAULT 'normal'");
  addColumnIfMissing(db, 'production_local_daily_sales', 'seller_name', 'TEXT');
  addColumnIfMissing(db, 'production_clients', 'local_store_key', 'TEXT');
  addColumnIfMissing(db, 'production_client_visits', 'visited_by_user_id', 'INTEGER');
  addColumnIfMissing(db, 'production_client_visits', 'visitor_name', 'TEXT');
  addColumnIfMissing(db, 'production_client_visits', 'visit_type', "TEXT NOT NULL DEFAULT 'visit'");
  addColumnIfMissing(db, 'production_client_visits', 'result', 'TEXT');
  addColumnIfMissing(db, 'production_client_visits', 'next_visit_date', 'TEXT');
  addColumnIfMissing(db, 'production_client_visits', 'next_visit_type', 'TEXT');
  addColumnIfMissing(db, 'production_client_visits', 'order_id', 'INTEGER');
  addColumnIfMissing(db, 'production_client_visits', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'production_clients', 'guide_template_key', 'TEXT');
  addColumnIfMissing(db, 'production_clients', 'guide_logo_url', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'order_type', "TEXT NOT NULL DEFAULT 'order'");
  addColumnIfMissing(db, 'production_orders', 'is_sample', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_orders', 'parent_order_id', 'INTEGER');
  addColumnIfMissing(db, 'production_orders', 'guide_template_key', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'sample_destination', 'TEXT');
  addColumnIfMissing(db, 'production_delivery_notes', 'destination', 'TEXT');
  addColumnIfMissing(db, 'production_delivery_notes', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'production_orders', 'delivery_date', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'origin_label', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'card_alert', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'dispatched_date', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'shipping_value', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_orders', 'discount_value', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_orders', 'invoice_number', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'invoice_date', 'TEXT');
  addColumnIfMissing(db, 'production_orders', 'invoice_value', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_remission_guides', 'recipient_name', 'TEXT');
  addColumnIfMissing(db, 'production_remission_guides', 'recipient_business_name', 'TEXT');
  addColumnIfMissing(db, 'production_remission_guides', 'recipient_tax_id', 'TEXT');
  addColumnIfMissing(db, 'production_remission_guides', 'format_type', "TEXT NOT NULL DEFAULT 'producalza'");
  addColumnIfMissing(db, 'production_order_models', 'unit_price', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_employees', 'source_name', 'TEXT');
  addColumnIfMissing(db, 'production_employees', 'pay_type', "TEXT NOT NULL DEFAULT 'salary'");
  addColumnIfMissing(db, 'production_employees', 'monthly_salary', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_employees', 'default_iess', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_employees', 'late_penalty', 'REAL NOT NULL DEFAULT 5');
  addColumnIfMissing(db, 'production_employees', 'normal_start', "TEXT NOT NULL DEFAULT '08:00'");
  addColumnIfMissing(db, 'production_employees', 'normal_end', "TEXT NOT NULL DEFAULT '16:30'");
  addColumnIfMissing(db, 'production_employees', 'grace_minutes', 'INTEGER NOT NULL DEFAULT 4');
  addColumnIfMissing(db, 'production_employees', 'status', "TEXT NOT NULL DEFAULT 'active'");
  addColumnIfMissing(db, 'production_employees', 'notes', 'TEXT');
  addColumnIfMissing(db, 'production_payroll_entries', 'overtime_50_hours', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_payroll_entries', 'overtime_100_hours', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_payroll_entries', 'overtime_100_rate', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_payroll_entries', 'loan_amount', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_payroll_entries', 'justify_late', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'production_payroll_entries', 'justify_absence', 'INTEGER NOT NULL DEFAULT 0');
  db.prepare(
    `UPDATE production_payroll_entries
     SET overtime_50_hours = CASE WHEN overtime_50_hours = 0 THEN overtime_hours ELSE overtime_50_hours END,
         overtime_100_rate = CASE WHEN overtime_100_rate = 0 AND hourly_rate > 0 THEN hourly_rate * 2 ELSE overtime_100_rate END`
  ).run();
  db.prepare(
    `UPDATE production_client_visits
     SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at),
         visit_type = COALESCE(NULLIF(visit_type, ''), 'visit')
     WHERE updated_at IS NULL OR updated_at = '' OR visit_type IS NULL OR visit_type = ''`
  ).run();

  let establishment = db.prepare("SELECT * FROM establishments WHERE name = 'PRODUCALZA'").get();
  if (!establishment) {
    const result = db
      .prepare(
        `INSERT INTO establishments
         (name, display_name, business_type, module_type, code_prefix, theme, logo_url, admin_username, admin_password, status, promoter_sales_enabled)
         VALUES (?, ?, 'commercial', 'production', ?, ?, ?, ?, ?, 'active', 0)`
      )
      .run('PRODUCALZA', 'PRODUCALZA', 'PROD', 'producalza', '', 'producalza', 'producalza123');
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare(
      `UPDATE establishments
       SET business_type = 'commercial',
           module_type = 'production',
           promoter_sales_enabled = 0,
           code_prefix = COALESCE(NULLIF(code_prefix, ''), 'PROD'),
           theme = COALESCE(NULLIF(theme, ''), 'producalza'),
           admin_username = COALESCE(NULLIF(admin_username, ''), 'producalza'),
           admin_password = COALESCE(NULLIF(admin_password, ''), 'producalza123')
       WHERE id = ?`
    ).run(establishment.id);
    establishment = db.prepare('SELECT * FROM establishments WHERE id = ?').get(establishment.id);
  }

  db.prepare(
    `INSERT OR IGNORE INTO production_settings (establishment_id, key, value)
     VALUES (?, 'next_card_number', '62')`
  ).run(establishment.id);

  seedLocalStores(db, establishment.id);
  seedLocalSecretary(db, establishment.id);
  seedLocalStaff(db, establishment.id);
  normalizeLocalStoreReferences(db);

  db.prepare('DELETE FROM production_monthly_report_rows WHERE establishment_id = ?').run(establishment.id);
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function normalizeLocalStoreName(value = '') {
  const raw = String(value || '').trim();
  const clean = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
  if (!clean) return '';
  if (clean.includes('NORTE')) return 'Local Marjorie Botas Norte';
  if (clean.includes('SUR')) return 'Local Marjorie Botas Sur';
  if (clean.includes('VALLE')) return 'Local Marjorie Botas Valle';
  if (clean.includes('BOSQUE') || clean.includes('SEBAST')) return 'Sebastians';
  return raw;
}

function normalizeLocalStoreArray(value = '[]') {
  let items = [];
  try {
    items = JSON.parse(value || '[]');
  } catch {
    items = [];
  }
  const normalized = [];
  for (const item of items) {
    const location = normalizeLocalStoreName(item);
    if (location && !normalized.includes(location)) normalized.push(location);
  }
  return JSON.stringify(normalized);
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

function normalizeColumnValues(db, table, column) {
  if (!hasColumn(db, table, column)) return;
  const rows = db
    .prepare(`SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND TRIM(${column}) <> ''`)
    .all();
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
  for (const row of rows) {
    const normalized = normalizeLocalStoreName(row.value);
    if (normalized && normalized !== row.value) {
      try {
        update.run(normalized, row.id);
      } catch {
        // Some monthly tables have unique constraints; leave those rare conflicts untouched instead of blocking startup.
      }
    }
  }
}

function normalizeLocalStaffLocations(db) {
  if (!hasColumn(db, 'production_local_staff', 'allowed_locations_json')) return;
  const rows = db
    .prepare('SELECT id, allowed_locations_json, default_location FROM production_local_staff')
    .all();
  const update = db.prepare(
    `UPDATE production_local_staff
     SET allowed_locations_json = ?, default_location = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  );
  for (const row of rows) {
    const allowed = normalizeLocalStoreArray(row.allowed_locations_json);
    const defaultLocation = normalizeLocalStoreName(row.default_location);
    if (allowed !== (row.allowed_locations_json || '[]') || defaultLocation !== (row.default_location || '')) {
      update.run(allowed, defaultLocation, row.id);
    }
  }
}

function mergeDuplicateLocalClients(db) {
  const stores = {
    'Local Marjorie Botas Norte': { key: 'marjorie-norte', city: 'Norte', brand: 'Marjorie Botas' },
    'Local Marjorie Botas Sur': { key: 'marjorie-sur', city: 'Sur', brand: 'Marjorie Botas' },
    'Local Marjorie Botas Valle': { key: 'marjorie-valle', city: 'Valle', brand: 'Marjorie Botas' },
    Sebastians: { key: 'sebastians', city: 'El Bosque', brand: 'Sebastians' }
  };
  const clients = db
    .prepare(
      `SELECT id, establishment_id, name, local_store_key
       FROM production_clients
       WHERE local_store_key IS NOT NULL
          OR upper(name) LIKE '%MARJORIE%'
          OR upper(name) LIKE '%SEBAST%'
          OR upper(name) IN ('NORTE', 'SUR', 'VALLE', 'BOSQUE')`
    )
    .all();
  const groups = new Map();
  for (const client of clients) {
    const name = normalizeLocalStoreName(client.name);
    if (!stores[name]) continue;
    const key = `${client.establishment_id}:${name}`;
    groups.set(key, [...(groups.get(key) || []), { ...client, normalizedName: name }]);
  }
  const clientReferenceTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
    .filter((table) => hasColumn(db, table, 'client_id'));
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const aExact = a.name === a.normalizedName ? 0 : 1;
      const bExact = b.name === b.normalizedName ? 0 : 1;
      return aExact - bExact || a.id - b.id;
    });
    const [canonical, ...duplicates] = group;
    const store = stores[canonical.normalizedName];
    db.prepare(
      `UPDATE production_clients
       SET name = ?, local_store_key = ?, city = COALESCE(NULLIF(city, ''), ?),
           brand = COALESCE(NULLIF(brand, ''), ?),
           classification = COALESCE(NULLIF(classification, ''), 'Local comercial'),
           updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(canonical.normalizedName, store.key, store.city, store.brand, canonical.id);
    for (const duplicate of duplicates) {
      for (const table of clientReferenceTables) {
        db.prepare(`UPDATE ${table} SET client_id = ? WHERE client_id = ?`).run(canonical.id, duplicate.id);
      }
      db.prepare('DELETE FROM production_clients WHERE id = ?').run(duplicate.id);
    }
  }
}

function normalizeLocalStoreReferences(db) {
  db.transaction(() => {
    const columns = [
      ['production_delivery_notes', 'destination'],
      ['production_local_attendance', 'location'],
      ['production_local_daily_sales', 'local_name'],
      ['production_local_finances', 'local_name'],
      ['production_local_monthly_reports', 'local_name'],
      ['production_local_payroll_cards', 'local_name'],
      ['production_orders', 'sample_destination'],
      ['production_return_allocations', 'destination']
    ];
    for (const [table, column] of columns) {
      normalizeColumnValues(db, table, column);
    }
    normalizeLocalStaffLocations(db);
    mergeDuplicateLocalClients(db);
  })();
}

function seedLocalStores(db, establishmentId) {
  const stores = [
    ['marjorie-norte', 'Local Marjorie Botas Norte', 'Norte', 'Marjorie Botas'],
    ['marjorie-sur', 'Local Marjorie Botas Sur', 'Sur', 'Marjorie Botas'],
    ['marjorie-valle', 'Local Marjorie Botas Valle', 'Valle', 'Marjorie Botas'],
    ['sebastians', 'Sebastians', 'El Bosque', 'Sebastians']
  ];
  const updateExisting = db.prepare(
    `UPDATE production_clients
     SET local_store_key = ?, brand = COALESCE(NULLIF(brand, ''), ?),
         city = COALESCE(NULLIF(city, ''), ?),
         classification = COALESCE(NULLIF(classification, ''), 'Local comercial')
     WHERE establishment_id = ? AND name = ?`
  );
  const find = db.prepare('SELECT id FROM production_clients WHERE establishment_id = ? AND name = ?');
  const insert = db.prepare(
    `INSERT INTO production_clients
     (establishment_id, name, city, brand, local_store_key, classification, general_notes)
     VALUES (?, ?, ?, ?, ?, 'Local comercial', 'Cliente interno para pedidos de locales')`
  );
  for (const [key, name, city, brand] of stores) {
    const current = find.get(establishmentId, name);
    if (current) {
      updateExisting.run(key, brand, city, establishmentId, name);
    } else {
      insert.run(establishmentId, name, city, brand, key);
    }
  }
}

function seedLocalSecretary(db, establishmentId) {
  db.prepare(
    `INSERT INTO production_users
     (establishment_id, name, username, password, role, can_view_all_orders, is_local_secretary, status)
     VALUES (?, 'Secretaria Locales', 'locales', 'locales123', 'vendor', 0, 1, 'active')
     ON CONFLICT(username) DO UPDATE SET
       establishment_id = excluded.establishment_id,
       name = excluded.name,
       role = 'vendor',
       can_view_all_orders = 0,
       is_local_secretary = 1,
       status = 'active'`
  ).run(establishmentId);
}

function seedLocalStaff(db, establishmentId) {
  const staff = [
    ['Liliana Jima', 'liliana', 'liliana123', ['Local Marjorie Botas Norte'], 'Local Marjorie Botas Norte'],
    ['Selena Sarango', 'selena', 'selena123', ['Local Marjorie Botas Sur'], 'Local Marjorie Botas Sur'],
    ['Nayely Vera', 'nayely', 'nayely123', ['Local Marjorie Botas Valle'], 'Local Marjorie Botas Valle'],
    ['Belen', 'belen', 'belen123', ['Sebastians'], 'Sebastians'],
    ['Yamileth', 'yamileth', 'yamileth123', ['Local Marjorie Botas Sur', 'Local Marjorie Botas Valle', 'Sebastians'], 'Local Marjorie Botas Valle']
  ];
  const statement = db.prepare(
    `INSERT INTO production_local_staff
     (establishment_id, name, username, password, allowed_locations_json, default_location, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')
     ON CONFLICT(username) DO UPDATE SET
       establishment_id = excluded.establishment_id,
       name = excluded.name,
       password = excluded.password,
       allowed_locations_json = excluded.allowed_locations_json,
       default_location = excluded.default_location,
       status = 'active',
       updated_at = datetime('now', 'localtime')`
  );
  for (const item of staff) {
    statement.run(establishmentId, item[0], item[1], item[2], JSON.stringify(item[3]), item[4]);
  }
}
