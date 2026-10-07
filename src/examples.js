// Synthetic examples; every one is run by test/playground.test.js.
export const examples = [
  {
    name: "Rename & drop fields",
    input: {
      id: 42, first_name: "Ada", last_name: "Lovelace", email: "ada@example.com",
      internal_flags: ["beta"], phone: null, country: "gb",
    },
    jslt: `// "* - a, b : ." copies every remaining key as-is
{
  "id": .id,
  "name": .first_name + " " + .last_name,
  "email": lowercase(.email),
  "country": uppercase(.country),
  * - id, first_name, last_name, email, country, internal_flags : .
}
`,
  },
  {
    name: "Order → invoice",
    input: {
      orderId: "SO-1001",
      customer: { name: "Acme Corp", vat: "DE123" },
      lines: [
        { sku: "A-1", title: "Widget", qty: 3, unitPrice: 9.99 },
        { sku: "B-7", title: "Gadget", qty: 1, unitPrice: 120 },
        { sku: "C-2", title: "Gizmo", qty: 10, unitPrice: 2.5 },
      ],
    },
    jslt: `let taxRate = 0.19
let lines = [for (.lines) {
  "sku": .sku,
  "description": .title,
  "quantity": .qty,
  "net": round(.qty * .unitPrice * 100) / 100
}]
let net = sum([for ($lines) .net])

{
  "invoiceNo": "INV-" + .orderId,
  "billTo": .customer.name,
  "lines": $lines,
  "net": $net,
  "tax": round($net * $taxRate * 100) / 100,
  "gross": round($net * (1 + $taxRate) * 100) / 100
}
`,
  },
  {
    name: "Customer cleanup",
    input: {
      fullName: "  lovelace,  ada ",
      emails: ["ADA@Example.com", "ada@example.com", "a.lovelace@work.test"],
      phone: null,
      address: { street: "12 Analytical St", city: "London" },
    },
    jslt: `def clean(s) trim($s)

let parts = split(clean(.fullName), "\\\\s*,\\\\s*")

{
  "lastName": uppercase($parts[0]),
  "firstName": $parts[1],
  "emails": [for (.emails) lowercase(.)],
  "primaryEmail": lowercase(.emails[0]),
  "phone": fallback(.phone, "n/a"),
  "city": .address.city,
  "country": fallback(.address.country, "unknown")
}
`,
  },
  {
    name: "Flatten nested rows",
    input: {
      orders: [
        { id: "A", items: [{ sku: "x", qty: 2 }, { sku: "y", qty: 1 }] },
        { id: "B", items: [{ sku: "z", qty: 5 }] },
      ],
    },
    jslt: `// one flat row per order item, parent id carried down
def rows(order)
  [for ($order.items) {
    "order": $order.id,
    "sku": .sku,
    "qty": .qty
  }]

flatten([for (.orders) rows(.)])
`,
  },
  {
    name: "Status mapping",
    input: [
      { id: 1, state: "P", amount: 20 },
      { id: 2, state: "S", amount: 450 },
      { id: 3, state: "X", amount: 5 },
    ],
    jslt: `def label(code)
  if ($code == "P") "pending"
  else if ($code == "S") "shipped"
  else "unknown"

[for (.) {
  "id": .id,
  "status": label(.state),
  "priority": if (.amount > 100) "high" else "normal"
}]
`,
  },
  {
    name: "Dynamic keys",
    input: {
      prices: { apple: 1.2, pear: 0.8, plum: 2 },
      currency: "EUR",
    },
    jslt: `// object comprehension: keys computed from the data
{
  "currency": .currency,
  "cents": {for (.prices) .key : round(.value * 100)},
  "expensive": [for (.prices) .key if (.value > 1)]
}
`,
  },
  {
    name: "Imports & helpers",
    input: {
      customer: { first: " Ada", last: "Lovelace " },
      lines: [{ qty: 2, price: 9.99 }, { qty: 1, price: 5 }],
    },
    jslt: `// lib.jslt is a second file (see the tab): call its functions as alias:name(...)
import "lib.jslt" as lib

{
  "customer": lib:full-name(.customer),
  "total": lib:money(sum([for (.lines) .qty * .price]))
}
`,
    files: [{
      name: "lib.jslt",
      text: `def full-name(p)
  trim($p.first) + " " + trim($p.last)

def money(n)
  string(round($n * 100) / 100) + " EUR"
`,
    }],
  },
  {
    name: "XML order → JSON",
    inputFormat: "xml",
    inputText: `<order id="SO-1001" currency="EUR">
  <customer>
    <name>Acme Corp</name>
    <vat>DE123</vat>
  </customer>
  <line sku="A-1" qty="3"><title>Widget</title><price>9.99</price></line>
  <line sku="B-7" qty="1"><title>Gadget</title><price>120</price></line>
</order>
`,
    // the JSON the XML above becomes (attributes as "@name"); the tests run the program on this
    input: {
      order: {
        "@id": "SO-1001", "@currency": "EUR",
        customer: { name: "Acme Corp", vat: "DE123" },
        line: [
          { "@sku": "A-1", "@qty": "3", title: "Widget", price: "9.99" },
          { "@sku": "B-7", "@qty": "1", title: "Gadget", price: "120" },
        ],
      },
    },
    jslt: `// XML arrives as JSON: attributes are "@name" keys, repeated elements an array, values are strings
{
  "id": .order."@id",
  "customer": .order.customer.name,
  "lines": [for (.order.line) {
    "sku": ."@sku",
    "qty": number(."@qty"),
    "net": number(.price) * number(."@qty")
  }]
}
`,
  },
  {
    name: "JSON → XML invoice",
    outputFormat: "xml",
    input: {
      orderId: "SO-1001",
      customer: { name: "Acme Corp" },
      lines: [{ sku: "A-1", title: "Widget" }, { sku: "B-7", title: "Gadget" }],
    },
    jslt: `// XML out: "@name" keys become attributes, "#text" is element text, an array repeats the element
{
  "invoice": {
    "@number": "INV-" + .orderId,
    "customer": .customer.name,
    "line": [for (.lines) {
      "@sku": .sku,
      "#text": .title
    }]
  }
}
`,
  },
  {
    name: "Dates",
    input: { created: "2024-03-09 14:30:00" },
    jslt: `let t = parse-time(.created, "yyyy-MM-dd HH:mm:ss")
{
  "day": format-time($t, "dd.MM.yyyy"),
  "time": format-time($t, "HH:mm")
}
`,
  },
];
