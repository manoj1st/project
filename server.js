const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));// edited
app.use(express.json()); //added
app.use(express.static("public"));

const db = new sqlite3.Database("customers.db");

db.run(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    joining_date TEXT,
    security_deposit TEXT,
    security_deposit_amount REAL,
    food TEXT,
    registration_fee REAL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS expense (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    category TEXT,
    amount REAL,
    note TEXT
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    source TEXT,
    amount REAL,
    description TEXT
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    month TEXT,
    amount REAL,
    paid_date TEXT
  )
`);

app.post("/save", (req, res) => {
  const {
    name,
    joining_date,
    security_deposit,
    security_deposit_amount,
    food,
    registration_fee
  } = req.body;

  const depositAmount =
    security_deposit === "Yes" && security_deposit_amount
      ? Number(security_deposit_amount)
      : 0;

  const regFee =
    registration_fee ? Number(registration_fee) : 0;

  db.serialize(() => {
    db.run(
      `INSERT INTO customers 
       (name, joining_date, security_deposit, security_deposit_amount, food, registration_fee)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name,
        joining_date,
        security_deposit,
        depositAmount,
        food,
        regFee
      ],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).send("Database error ❌");
        }

        if (depositAmount > 0) {
          db.run(
            `INSERT INTO income (date, source, amount, description)
             VALUES (?, ?, ?, ?)`,
            [
              joining_date,
              "Security Deposit",
              depositAmount,
              `Security deposit from ${name}`
            ]
          );
        }

        if (regFee > 0) {
          db.run(
            `INSERT INTO income (date, source, amount, description)
             VALUES (?, ?, ?, ?)`,
            [
              joining_date,
              "Registration Fee",
              regFee,
              `Registration fee from ${name}`
            ]
          );
        }

        res.send("Customer saved & income recorded ✅");
      }
    );
  });
});


app.get("/customers", (req, res) => {
  db.all("SELECT * FROM customers", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post("/expense", (req, res) => {
  const { date, category, amount, note } = req.body;

  db.run(
    "INSERT INTO expense (date, category, amount, note) VALUES (?, ?, ?, ?)",
    [date, category, amount, note],
    err => {
      if (err) return res.status(500).send(err.message);
      res.send("Expense saved");
    }
  );
});
app.get("/expense", (req, res) => {
  const month = req.query.month;
  let sql = "SELECT * FROM expense";
  let params = [];

  if (month) {
    sql += " WHERE strftime('%Y-%m', date) = ?";
    params.push(month);
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.json(rows);
  });
});

app.post("/income/save", (req, res) => {
  const { date, source, amount, description } = req.body;

  db.run(
    `INSERT INTO income (date, source, amount, description)
     VALUES (?, ?, ?, ?)`,
    [date, source, amount, description],
    (err) => {
      if (err) {
        console.error(err);
        res.status(500).send("Error saving income");
      } else {
        res.send("Income saved ✅");
      }
    }
  );
});
app.get("/income", (req, res) => {
  db.all("SELECT * FROM income", (err, rows) => {
    if (err) res.status(500).json(err);
    else res.json(rows);
  });
});
app.get("/income/cleanup", (req, res) => {
  db.run("DELETE FROM income", () => {
    res.send("Income table cleaned");
  });
});

app.get("/summary/total-income", (req, res) => {
  db.get(
    "SELECT SUM(amount) AS totalIncome FROM income",
    (err, row) => {
      if (err) res.status(500).json(err);
      else res.json(row);
    }
  );
});
app.get("/summary/total-expense", (req, res) => {
  db.get(
    "SELECT SUM(amount) AS totalExpense FROM expense",
    (err, row) => {
      if (err) res.status(500).json(err);
      else res.json(row);
    }
  );
});
app.get("/summary/monthly-income", (req, res) => {
  db.all(
    `
    SELECT substr(date, 1, 7) AS month,
           SUM(amount) AS totalIncome
    FROM income
    GROUP BY month
    ORDER BY month
    `,
    (err, rows) => {
      if (err) res.status(500).json(err);
      else res.json(rows);
    }
  );
});
app.get("/summary/monthly-expense", (req, res) => {
  db.all(
    `
    SELECT substr(date, 1, 7) AS month,
           SUM(amount) AS totalExpense
    FROM expense
    GROUP BY month
    ORDER BY month
    `,
    (err, rows) => {
      if (err) res.status(500).json(err);
      else res.json(rows);
    }
  );
});


app.post("/fee-payment", (req, res) => {
  const { customer_id, month, amount } = req.body;

  const paymentDate = month + "-01";

  // prevent duplicate payment for same month
  db.get(
    `SELECT id FROM payments WHERE customer_id = ? AND month = ?`,
    [customer_id, month],
    (err, row) => {
      if (row) {
        return res.send("Fee already paid for this month ❌");
      }

      db.serialize(() => {

        // save payment
        db.run(
          `INSERT INTO payments (customer_id, month, amount, paid_date)
           VALUES (?, ?, ?, ?)`,
          [customer_id, month, amount, paymentDate]
        );

        // get customer name
        db.get(
          `SELECT name FROM customers WHERE id = ?`,
          [customer_id],
          (err, customer) => {

            // add income
            db.run(
              `INSERT INTO income (date, source, amount, description)
               VALUES (?, ?, ?, ?)`,
              [
                paymentDate,
                "Monthly Fee",
                amount,
                `Monthly fee from ${customer.name} (${month})`
              ]
            );

            res.send("Monthly fee recorded ✅");
          }
        );
      });
    }
  );
});



app.listen(PORT, () => {
  console.log("Server running on http://localhost:3000");
});
app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});