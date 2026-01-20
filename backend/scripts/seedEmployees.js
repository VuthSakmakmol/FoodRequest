// scripts/seedEmployees.js
/* eslint-disable no-console */
const path = require('path')
const fs = require('fs')
const mongoose = require('mongoose')
require('dotenv').config()

// Adjust this path if model lives elsewhere
const EmployeeDirectory = require('../models/EmployeeDirectory')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing in your .env')
  process.exit(1)
}

// Default JSON input path
const DEFAULT_JSON = path.resolve(__dirname, '../staff1.json')
const ARG_PATH = process.argv[2] ? path.resolve(process.argv[2]) : null
const INPUT_PATH = ARG_PATH || DEFAULT_JSON

/* ───────── Normalize helper ───────── */
function normalizeRow(row) {
  // ID
  const employeeId = String(
    row.employeeId ?? row.EmployeeID ?? row.EMPLOYEE_ID ?? row.ID ?? row.Id ?? ''
  ).trim()

  // Name
  const name = (
    row.name ?? row.Name ?? row.FullName ?? row['Full Name'] ?? row['Employee Name'] ?? ''
  ).toString().trim()

  // Department
  const department = (
    row.department ?? row.Department ?? row.Dept ?? row['Department Name'] ?? 'Unknown'
  ).toString().trim()

  // Contact number
  const contactNumber = (
    row.contactNumber ?? row.ContactNumber ?? row['Contact Number'] ??
    row.Phone ?? row.Mobile ?? row['Phone Number'] ?? ''
  ).toString().trim()

  // Telegram Chat ID (✅ added)
  const telegramChatId = (
    row.telegramChatId ?? row.TelegramChatId ?? row.telegram ?? ''
  ).toString().trim()

  // Active flag
  let isActive = row.isActive ?? row.Active ?? row.active ?? row.Status
  if (typeof isActive === 'string') {
    const s = isActive.toLowerCase().trim()
    isActive = ['true', 'yes', 'active', '1', 'y'].includes(s)
  } else if (typeof isActive === 'number') {
    isActive = isActive !== 0
  } else if (typeof isActive !== 'boolean') {
    isActive = true
  }

  // Return full normalized object
  return { employeeId, name, department, contactNumber, isActive, telegramChatId }
}

/* ───────── Load source data ───────── */
function loadEmployees() {
  if (fs.existsSync(INPUT_PATH)) {
    try {
      const raw = fs.readFileSync(INPUT_PATH, 'utf8')
      const data = JSON.parse(raw)
      if (!Array.isArray(data)) {
        throw new Error('JSON root must be an array of employees')
      }
      console.log(`📄 Loaded ${data.length} rows from ${INPUT_PATH}`)
      return data.map(normalizeRow)
    } catch (e) {
      console.warn(`⚠️ Failed to read ${INPUT_PATH}: ${e.message}`)
      console.warn('➡️ Falling back to inline sample records.')
    }
  } else {
    console.log(`ℹ️ No JSON found at ${INPUT_PATH}. Using inline sample records.`)
  }

  // Fallback inline list — keep short; add more later
  
  return [
  {
    "employeeId": "51220044",
    "name": "Sam Saret",
    "department": "Accessory Warehouse",
    "contactNumber": "0964781348",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220045",
    "name": "Ean Socheata",
    "department": "Accessory Warehouse",
    "contactNumber": "070966589",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52421285",
    "name": "Leang Mengly",
    "department": "Accessory Warehouse",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520600",
    "name": "Om Veasna",
    "department": "Accessory Warehouse",
    "contactNumber": "081988898",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220526",
    "name": "Phorn Theavy",
    "department": "Accounting & Financial",
    "contactNumber": "092564366",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51221200",
    "name": "Srun Socheat",
    "department": "Accounting & Financial",
    "contactNumber": "012739377",
    "telegramChatId": "1278119141",
    "isActive": true
  },
  {
    "employeeId": "51620103",
    "name": "Naran Phoumiseth",
    "department": "Accounting & Financial",
    "contactNumber": "099822525",
    "telegramChatId": "1212888135",
    "isActive": true
  },
  {
    "employeeId": "51921076",
    "name": "Huot Sievei",
    "department": "Accounting & Financial",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52020316",
    "name": "Proeurn Soknang",
    "department": "Accounting & Financial",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320794",
    "name": "Vong Chanthoeun",
    "department": "Accounting & Financial",
    "contactNumber": "093973755",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420147",
    "name": "Chhoun Sodavan",
    "department": "Accounting & Financial",
    "contactNumber": "017372744",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520296",
    "name": "Phon Sreynin",
    "department": "Accounting & Financial",
    "contactNumber": "0978783293",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520582",
    "name": "Vann Vipha",
    "department": "Accounting & Financial",
    "contactNumber": "089939692",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520624",
    "name": "Vorn Sothean",
    "department": "Accounting & Financial",
    "contactNumber": "0964904096",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51321149",
    "name": "Sao Saren",
    "department": "Adicomp",
    "contactNumber": "0888275512",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51720683",
    "name": "Chheng Ratanakchakreya",
    "department": "Adicomp",
    "contactNumber": "078850229",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52020835",
    "name": "Moa Kimleang",
    "department": "Adicomp",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52221210",
    "name": "Yong Laihea",
    "department": "Adicomp",
    "contactNumber": "069761300",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420820",
    "name": "Chorn Lakena",
    "department": "Adminstration",
    "contactNumber": "087223191",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520782",
    "name": "Nour Phalla",
    "department": "Cutting",
    "contactNumber": "0963605227",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52521082",
    "name": "Neang Makara",
    "department": "Cutting",
    "contactNumber": "0885687779",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820960",
    "name": "Satt Romnear",
    "department": "Fabric Warehouse",
    "contactNumber": "010656620",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51821309",
    "name": "Phon Chandy",
    "department": "Fabric Warehouse",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320001",
    "name": "Ly Leng Gech",
    "department": "Fabric Warehouse",
    "contactNumber": "0964766103",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520499",
    "name": "Chrev Ahdit",
    "department": "Fabric Warehouse",
    "contactNumber": "0969573434",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51720403",
    "name": "Cheab Da",
    "department": "Finishing Goods",
    "contactNumber": "0964188784",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820361",
    "name": "Meas Ping",
    "department": "Finishing Goods",
    "contactNumber": "016904475",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220018",
    "name": "Pok Map",
    "department": "HR and Payroll",
    "contactNumber": "012737325",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220831",
    "name": "Yorn Sokhim",
    "department": "HR and Payroll",
    "contactNumber": "078677686",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220859",
    "name": "Sam Sambat",
    "department": "HR and Payroll",
    "contactNumber": "012777954",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51420303",
    "name": "Mao Malybella",
    "department": "HR and Payroll",
    "contactNumber": "010655592",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820275",
    "name": "Kim Sokreaksmey",
    "department": "HR and Payroll",
    "contactNumber": "015333638",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820386",
    "name": "Srun Rida",
    "department": "HR and Payroll",
    "contactNumber": "070707460",
    "telegramChatId": "7163451169",
    "isActive": true
  },
  {
    "employeeId": "51821047",
    "name": "Sot Sreynit",
    "department": "HR and Payroll",
    "contactNumber": "015347477",
    "telegramChatId": "1055055243",
    "isActive": true
  },
  {
    "employeeId": "52020942",
    "name": "Suon Tithyamatinine",
    "department": "HR and Payroll",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52120446",
    "name": "Lit Sony",
    "department": "HR and Payroll",
    "contactNumber": "010831736",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52120644",
    "name": "Heng Soksang",
    "department": "HR and Payroll",
    "contactNumber": "012840910",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320614",
    "name": "Mai Malen",
    "department": "HR and Payroll",
    "contactNumber": "016918949",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320615",
    "name": "Lor Mengkong",
    "department": "HR and Payroll",
    "contactNumber": "012578090",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320660",
    "name": "Yim Siphea Van",
    "department": "HR and Payroll",
    "contactNumber": "070956122",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320793",
    "name": "Eoun Sochetra",
    "department": "HR and Payroll",
    "contactNumber": "070278595",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420937",
    "name": "Sim Sreynech",
    "department": "HR and Payroll",
    "contactNumber": "0968713085",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52421351",
    "name": "Seang Rachana",
    "department": "HR and Payroll",
    "contactNumber": "014653665",
    "telegramChatId": "328458629",
    "isActive": true
  },
  {
    "employeeId": "52421482",
    "name": "Van Kakada",
    "department": "HR and Payroll",
    "contactNumber": "012963640",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520078",
    "name": "Vat Sotheavy",
    "department": "HR and Payroll",
    "contactNumber": "015915284",
    "telegramChatId": "1673844206",
    "isActive": true
  },
  {
    "employeeId": "52520240",
    "name": "Morm Soriya",
    "department": "HR and Payroll",
    "contactNumber": "0977573073",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520244",
    "name": "Leng Puthy",
    "department": "HR and Payroll",
    "contactNumber": "0968337875",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520298",
    "name": "Lip Kimleang",
    "department": "HR and Payroll",
    "contactNumber": "061705800",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520299",
    "name": "Say Somalin",
    "department": "HR and Payroll",
    "contactNumber": "087957877",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520351",
    "name": "Vuth Sakmakmol",
    "department": "HR and Payroll",
    "contactNumber": "0979866163",
    "telegramChatId": "7163451169",
    "isActive": true
  },
  {
    "employeeId": "52520651",
    "name": "Sok Sreyroth",
    "department": "HR and Payroll",
    "contactNumber": "010335532",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520684",
    "name": "Phin SamPhosh",
    "department": "HR and Payroll",
    "contactNumber": "010231800",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520977",
    "name": "Thol Chhorla",
    "department": "HR and Payroll",
    "contactNumber": "087788197",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51321479",
    "name": "Chhith Sakminea",
    "department": "Industrial Engineering",
    "contactNumber": "085247130",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51921289",
    "name": "Vann Vannak",
    "department": "Industrial Engineering",
    "contactNumber": "098466535",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52020705",
    "name": "Yoeurn Sokmy",
    "department": "Industrial Engineering",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52120531",
    "name": "Sok Phana",
    "department": "Industrial Engineering",
    "contactNumber": "0965743856",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220298",
    "name": "Lun Sokha",
    "department": "Industrial Engineering",
    "contactNumber": "016975425",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52221310",
    "name": "Leang Phayna",
    "department": "Industrial Engineering",
    "contactNumber": "0967618188",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420161",
    "name": "Yen Socheat",
    "department": "Industrial Engineering",
    "contactNumber": "086487388",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420316",
    "name": "Larch Sokha",
    "department": "Industrial Engineering",
    "contactNumber": "087527838",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420748",
    "name": "Bun Sros",
    "department": "Industrial Engineering",
    "contactNumber": "0965292800",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52421265",
    "name": "Nong Yang",
    "department": "Industrial Engineering",
    "contactNumber": "0977269226",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520297",
    "name": "Larch Sophy",
    "department": "Industrial Engineering",
    "contactNumber": "081801243",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520424",
    "name": "Sam Leaknika",
    "department": "Industrial Engineering",
    "contactNumber": "0765043345",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520425",
    "name": "Vin Kalyan",
    "department": "Industrial Engineering",
    "contactNumber": "0965147866",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520426",
    "name": "Sreng Chakreya",
    "department": "Industrial Engineering",
    "contactNumber": "086675428",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520621",
    "name": "Ut Vanndy",
    "department": "Industrial Engineering",
    "contactNumber": "086649769",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520795",
    "name": "Huon Bonnanath",
    "department": "Industrial Engineering",
    "contactNumber": "087911294",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520874",
    "name": "Von Mithona",
    "department": "Industrial Engineering",
    "contactNumber": "093428454",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520927",
    "name": "Han Daven",
    "department": "Industrial Engineering",
    "contactNumber": "0883010059",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220041",
    "name": "Hamit Askollany",
    "department": "IT Support",
    "contactNumber": "012295001",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51921385",
    "name": "Nom Sokkeo",
    "department": "IT Support",
    "contactNumber": "010290665",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210018",
    "name": "Ninart Kongjaroen",
    "department": "Management Office",
    "contactNumber": "070 825 643",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210020",
    "name": "Pollawut Patumpattanakit",
    "department": "Management Office",
    "contactNumber": "096 470 7019",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210027",
    "name": "Chantip Jithaisong",
    "department": "Management Office",
    "contactNumber": "096 641 8799",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51410011",
    "name": "Pittaya Kerdsriphan",
    "department": "Management Office",
    "contactNumber": "092 694 029",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51410012",
    "name": "Evangeline FloresIgos",
    "department": "Management Office",
    "contactNumber": "085 958 954",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51410014",
    "name": "Boonkiat Jungsaisawangphan",
    "department": "Management Office",
    "contactNumber": "081284523",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51510019",
    "name": "Kristopher GuiamDino",
    "department": "Management Office",
    "contactNumber": "066418799",
    "telegramChatId": "1894826858",
    "isActive": true
  },
  {
    "employeeId": "51910006",
    "name": "NIRATCHADAPORN  TANGJAI",
    "department": "Management Office",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51910011",
    "name": "SHINNASORN  PHIMPHASOOT",
    "department": "Management Office",
    "contactNumber": "089 333 785",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51910020",
    "name": "Kittitanakasame  Aiyarat",
    "department": "Management Office",
    "contactNumber": "096 8316562",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52010006",
    "name": "PISIAO MALA ELORDE",
    "department": "Management Office",
    "contactNumber": "015452474",
    "telegramChatId": "5075400953",
    "isActive": true
  },
  {
    "employeeId": "52210006",
    "name": "ARTPHONGSA PRAPAPHAN",
    "department": "Management Office",
    "contactNumber": "061840031",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52210007",
    "name": "KUMWONG KOONTIP",
    "department": "Management Office",
    "contactNumber": "095247266",
    "telegramChatId": "6457848091",
    "isActive": true
  },
  {
    "employeeId": "52210008",
    "name": "MUNTHAWIN TIYAPHON",
    "department": "Management Office",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510004",
    "name": "ZIN MINN PAING",
    "department": "Management Office",
    "contactNumber": "0",
    "telegramChatId": "1682753821",
    "isActive": true
  },
  {
    "employeeId": "52510011",
    "name": "Lara Jade Obispo Hernel",
    "department": "Management Office",
    "contactNumber": "0",
    "telegramChatId": "8586270804",
    "isActive": true
  },
  {
    "employeeId": "51210010",
    "name": "Banchong Kaeokanda",
    "department": "Management Production",
    "contactNumber": "061 277 577",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210024",
    "name": "Joel TautoanArcayan",
    "department": "Management Production",
    "contactNumber": "016 694 422",
    "telegramChatId": "8271477569",
    "isActive": true
  },
  {
    "employeeId": "51210028",
    "name": "Saard Kaeokanda",
    "department": "Management Production",
    "contactNumber": "061 832 908",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210032",
    "name": "Nares Samoemuean",
    "department": "Management Production",
    "contactNumber": "096 889 9675",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210034",
    "name": "RicardoIII BugtoCabidig",
    "department": "Management Production",
    "contactNumber": "012231925",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210038",
    "name": "Sompong Thanee",
    "department": "Management Production",
    "contactNumber": "017 922 956",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210039",
    "name": "Boonmee Promsungyang",
    "department": "Management Production",
    "contactNumber": "096 881 7649",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51210040",
    "name": "Kriangkrai Yubunchai",
    "department": "Management Production",
    "contactNumber": "096 8316562",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51510015",
    "name": "Sompan Purampha",
    "department": "Management Production",
    "contactNumber": "081 491 431",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51510023",
    "name": "Ratri Phunsahwat",
    "department": "Management Production",
    "contactNumber": "0969462652",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51710015",
    "name": "Arthit Sahwatnathi",
    "department": "Management Production",
    "contactNumber": "096-5697544",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51810010",
    "name": "AldrinEmil TipawanDionco",
    "department": "Management Production",
    "contactNumber": "085259143",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51810018",
    "name": "GURUSAMY  THANGAPANDI",
    "department": "Management Production",
    "contactNumber": "081 493 612",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51810026",
    "name": "MARK  JUSTO  BRACAMONTE",
    "department": "Management Production",
    "contactNumber": "089 645 200",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51910012",
    "name": "Arcayan  Chona  Mantos",
    "department": "Management Production",
    "contactNumber": "017 245 475",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51910017",
    "name": "PATHINYA  CHINNARUK",
    "department": "Management Production",
    "contactNumber": "081 491 431",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52010003",
    "name": "AMORES INDERIO DEXTER LAURENCE",
    "department": "Management Production",
    "contactNumber": "096 420 5783",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52110001",
    "name": "JETHRO JAMES THOMAS",
    "department": "Management Production",
    "contactNumber": "099217362",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52210002",
    "name": "Ananchanin Phekong",
    "department": "Management Production",
    "contactNumber": "0965642895",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52310003",
    "name": "JEAN MARIE AGBONES",
    "department": "Management Production",
    "contactNumber": "085806945",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52310006",
    "name": "Naksorn Chatchanop",
    "department": "Management Production",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52310007",
    "name": "Rankoth Pathiranage Hasintha Lakshan Jayasinghe",
    "department": "Management Production",
    "contactNumber": "016833827",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52410002",
    "name": "ARANA ELMER DELOS REYES",
    "department": "Management Production",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52410003",
    "name": "THAMMITAGE DUSHAN SAJITH THILAKASIRI",
    "department": "Management Production",
    "contactNumber": "093584230",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52410006",
    "name": "MATIDIOS REMULTA JOYDEL",
    "department": "Management Production",
    "contactNumber": "0962606947",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52410008",
    "name": "DEGUIT CALUMBA RISTY",
    "department": "Management Production",
    "contactNumber": "0963228920",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52410009",
    "name": "THANKLANG KITTHINON",
    "department": "Management Production",
    "contactNumber": "0966915161",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52410010",
    "name": "CASES AMOR ELIZABETH",
    "department": "Management Production",
    "contactNumber": "015454057",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52410011",
    "name": "MANANO SABELLANO MARY ANN",
    "department": "Management Production",
    "contactNumber": "010885473",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52410012",
    "name": "ONOFRE DIZON REYNALYN",
    "department": "Management Production",
    "contactNumber": "0966915161",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510002",
    "name": "Rajitha Prabhashshara",
    "department": "Management Production",
    "contactNumber": "0962927673",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510005",
    "name": "BOONYAPA PAKARE",
    "department": "Management Production",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510006",
    "name": "RAYMUNDO VILLAGONZALO",
    "department": "Management Production",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510007",
    "name": "QUIZADA KENT ASEQUIA",
    "department": "Management Production",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510008",
    "name": "MA. CELILIA SANTOS",
    "department": "Management Production",
    "contactNumber": "0978701431",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510010",
    "name": "MARYVIC LICAY-LICAY",
    "department": "Management Production",
    "contactNumber": "097 700 2607",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510012",
    "name": "Joven Teodosio Castaneda",
    "department": "Management Production",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510013",
    "name": "Montajes Munez Ernie Jr.",
    "department": "Management Production",
    "contactNumber": "076 601 0574",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52510014",
    "name": "Pedrano Ulnie Kim Molejon",
    "department": "Management Production",
    "contactNumber": "086 649 550",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51320263",
    "name": "Young Bunthoeu",
    "department": "Merchandise",
    "contactNumber": "012334458",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51321118",
    "name": "Ken Sophea",
    "department": "Merchandise",
    "contactNumber": "017889271",
    "telegramChatId": "1183658210",
    "isActive": true
  },
  {
    "employeeId": "51321473",
    "name": "Tuy Sokchoeurn",
    "department": "Merchandise",
    "contactNumber": "0972284082",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51520172",
    "name": "An Kosal",
    "department": "Merchandise",
    "contactNumber": "017830922",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51520758",
    "name": "Chheng Socheata",
    "department": "Merchandise",
    "contactNumber": "010890899",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820057",
    "name": "Khiev Rinnaro",
    "department": "Merchandise",
    "contactNumber": "0974030845",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820306",
    "name": "Heang Vuchnear",
    "department": "Merchandise",
    "contactNumber": "0978952085",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820541",
    "name": "Mao Daly",
    "department": "Merchandise",
    "contactNumber": "0966298957",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51920974",
    "name": "Sim Veasna",
    "department": "Merchandise",
    "contactNumber": "016551873",
    "telegramChatId": "1334734870",
    "isActive": true
  },
  {
    "employeeId": "52220001",
    "name": "Houn Pisey",
    "department": "Merchandise",
    "contactNumber": "0977758951",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220197",
    "name": "Dim Kunthearat",
    "department": "Merchandise",
    "contactNumber": "070674882",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220481",
    "name": "Touch Phors",
    "department": "Merchandise",
    "contactNumber": "0963610030",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320475",
    "name": "Sawaengdee Siriphon",
    "department": "Merchandise",
    "contactNumber": "069527041",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320476",
    "name": "Prak Seryrith",
    "department": "Merchandise",
    "contactNumber": "086833193",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420330",
    "name": "Hum Sivorn",
    "department": "Merchandise",
    "contactNumber": "099992604",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420710",
    "name": "Pich Nyrachana",
    "department": "Merchandise",
    "contactNumber": "0965196987",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52421102",
    "name": "Lory Long Y",
    "department": "Merchandise",
    "contactNumber": "087240381",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520001",
    "name": "Srean Thavy",
    "department": "Merchandise",
    "contactNumber": "085732539",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520236",
    "name": "Thouy Sonika",
    "department": "Merchandise",
    "contactNumber": "0969981123",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520428",
    "name": "Ny Pheakdey",
    "department": "Merchandise",
    "contactNumber": "093767789",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520554",
    "name": "Seng Sokpisey",
    "department": "Merchandise",
    "contactNumber": "015242271",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520812",
    "name": "Sum Vandoeun",
    "department": "Merchandise",
    "contactNumber": "0963217088",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51720078",
    "name": "Sreem Leanghoun",
    "department": "Pattern & Marker",
    "contactNumber": "098255299",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220068",
    "name": "Pen Vanny",
    "department": "Production Planning",
    "contactNumber": "0969625806",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51420165",
    "name": "Dom Lim",
    "department": "Production Planning",
    "contactNumber": "086462905",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52021058",
    "name": "Pich Lun",
    "department": "Production Planning",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220876",
    "name": "San SamNang",
    "department": "Quality Assurance",
    "contactNumber": "070463296",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51320096",
    "name": "Sreang Vuthy",
    "department": "Quality Assurance",
    "contactNumber": "012757465",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51320106",
    "name": "Yan Seivhour",
    "department": "Quality Assurance",
    "contactNumber": "070269667",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51420067",
    "name": "Nhoeurng Sophal",
    "department": "Quality Assurance",
    "contactNumber": "077938836",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820876",
    "name": "Kon Rothana",
    "department": "Quality Assurance",
    "contactNumber": "0889864170",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820978",
    "name": "Khut Panha",
    "department": "Quality Assurance",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52120017",
    "name": "Suy Sreyleak",
    "department": "Quality Assurance",
    "contactNumber": "0963697007",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52120889",
    "name": "Sokhom Sreyya",
    "department": "Quality Assurance",
    "contactNumber": "0888903120",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220317",
    "name": "Nang Sreynich",
    "department": "Quality Assurance",
    "contactNumber": "0883390641",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220340",
    "name": "Ly Chhayna",
    "department": "Quality Assurance",
    "contactNumber": "061365618",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220351",
    "name": "Nen Linda",
    "department": "Quality Assurance",
    "contactNumber": "0719831918",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220457",
    "name": "Sam Sereythanit",
    "department": "Quality Assurance",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52221203",
    "name": "Sov Dany",
    "department": "Quality Assurance",
    "contactNumber": "0968872495",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52221270",
    "name": "Prak Raksa",
    "department": "Quality Assurance",
    "contactNumber": "0964279400",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320443",
    "name": "Bros Vecheka",
    "department": "Quality Assurance",
    "contactNumber": "0963756576",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320784",
    "name": "Meung Muoykea",
    "department": "Quality Assurance",
    "contactNumber": "0975786298",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420262",
    "name": "Chea Phavy",
    "department": "Quality Assurance",
    "contactNumber": "0969385375",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420271",
    "name": "Seth Sorphy",
    "department": "Quality Assurance",
    "contactNumber": "078939538",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420384",
    "name": "Chhem Monseu",
    "department": "Quality Assurance",
    "contactNumber": "0967200940",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420680",
    "name": "Kou Sophy",
    "department": "Quality Assurance",
    "contactNumber": "0969563875",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420692",
    "name": "Yom Salina",
    "department": "Quality Assurance",
    "contactNumber": "068413056",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420902",
    "name": "Chin Sonita",
    "department": "Quality Assurance",
    "contactNumber": "099549395",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520069",
    "name": "Seng Hanna",
    "department": "Quality Assurance",
    "contactNumber": "092242301",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520097",
    "name": "Leng Sreylim",
    "department": "Quality Assurance",
    "contactNumber": "010614944",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520321",
    "name": "Thoeun Sokkhim",
    "department": "Quality Assurance",
    "contactNumber": "0889943556",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520510",
    "name": "Keo Daro",
    "department": "Quality Assurance",
    "contactNumber": "069685369",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520511",
    "name": "Chhoun Srey Lim",
    "department": "Quality Assurance",
    "contactNumber": "0965652199",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520536",
    "name": "Tam Sreysor",
    "department": "Quality Assurance",
    "contactNumber": "0965377622",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520553",
    "name": "Chea Savy",
    "department": "Quality Assurance",
    "contactNumber": "092818317",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51820093",
    "name": "Puon Sokna",
    "department": "Quality Control",
    "contactNumber": "093973932",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320381",
    "name": "Samnang Monyroth",
    "department": "Quality Control",
    "contactNumber": "093870073",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220011",
    "name": "Se Bunthoeun",
    "department": "Sewing",
    "contactNumber": "093451499",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220059",
    "name": "Meach Kosorl",
    "department": "Sewing",
    "contactNumber": "0967652736",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220212",
    "name": "Prum Savy",
    "department": "Sewing",
    "contactNumber": "0883766880",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220213",
    "name": "Seak Sokhorn",
    "department": "Sewing",
    "contactNumber": "0962410802",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220270",
    "name": "Thol SreyViet",
    "department": "Sewing",
    "contactNumber": "010532251",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220759",
    "name": "Suon Noeun",
    "department": "Sewing",
    "contactNumber": "086460007",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51221285",
    "name": "Samret Sokhom",
    "department": "Sewing",
    "contactNumber": "012257369",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51320029",
    "name": "Lun Sopheap",
    "department": "Sewing",
    "contactNumber": "016297379",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51320332",
    "name": "Sun SreyPov",
    "department": "Sewing",
    "contactNumber": "010257773",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51420870",
    "name": "Yun Sokim",
    "department": "Sewing",
    "contactNumber": "0969772008",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51620625",
    "name": "Chhon Srey aun",
    "department": "Sewing",
    "contactNumber": "015611609",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51921366",
    "name": "Thim Phalla",
    "department": "Sewing",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52030347",
    "name": "Huon Sreymech",
    "department": "Sewing",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52121304",
    "name": "Ngim Chamnan",
    "department": "Sewing",
    "contactNumber": "010737837",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220060",
    "name": "Hea Chanpanha",
    "department": "Sewing",
    "contactNumber": "089858046",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220318",
    "name": "Thol Sreynor",
    "department": "Sewing",
    "contactNumber": "070599717",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220802",
    "name": "Suon Sokkheng",
    "department": "Sewing",
    "contactNumber": "0962493972",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52221372",
    "name": "Torn Sreytouch",
    "department": "Sewing",
    "contactNumber": "0964747556",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52420318",
    "name": "Chhoam Sreymom",
    "department": "Sewing",
    "contactNumber": "078928072",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520361",
    "name": "Neth Vanna",
    "department": "Sewing",
    "contactNumber": "0979523871",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520586",
    "name": "Ly Sopheap",
    "department": "Sewing",
    "contactNumber": "0968099778",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51220670",
    "name": "Soun Channa",
    "department": "Shipping",
    "contactNumber": "077380007",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51520390",
    "name": "Hot Lyheng",
    "department": "Shipping",
    "contactNumber": "098848108",
    "telegramChatId": "7333433426",
    "isActive": true
  },
  {
    "employeeId": "51720462",
    "name": "Sun Sokhour",
    "department": "Shipping",
    "contactNumber": "078809447",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "51720602",
    "name": "Khoeun Chanmakara",
    "department": "Shipping",
    "contactNumber": "010561526",
    "telegramChatId": "515749835",
    "isActive": true
  },
  {
    "employeeId": "51821314",
    "name": "Khan Sreysros",
    "department": "Shipping",
    "contactNumber": "0",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52120926",
    "name": "Set Reaksmey",
    "department": "Shipping",
    "contactNumber": "070305289",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52220264",
    "name": "Chheun Kakta",
    "department": "Shipping",
    "contactNumber": "096771221",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52221421",
    "name": "Jean Chantourng",
    "department": "Shipping",
    "contactNumber": "0965170840",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52320830",
    "name": "Sat Ratha",
    "department": "Shipping",
    "contactNumber": "016240602",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520182",
    "name": "Yun Buntheng",
    "department": "Shipping",
    "contactNumber": "010438439",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52520617",
    "name": "Soem Kungkiet",
    "department": "Shipping",
    "contactNumber": "0963849696",
    "telegramChatId": "5536316392",
    "isActive": true
  }, 
  // Add new
  {
    "employeeId": "52521105",
    "name": "Yi Saovory",
    "department": "Merchandise",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
    {
    "employeeId": "52521251",
    "name": "Un Chhai roth",
    "department": "Merchandise",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52521301",
    "name": "Ket Kakvey",
    "department": "HR and Payroll",
    "contactNumber": "",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52521310",
    "name": "Ven Dalin",
    "department": "IT Support",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52521317",
    "name": "Yim Marady",
    "department": "Accounting & Financial",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52521352",
    "name": "Dy Samnang",
    "department": "Production Planning",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52521353",
    "name": "Hak Leangky",
    "department": "Sewing",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52521354",
    "name": "Loek Sreynuch",
    "department": "Merchandise",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52521355",
    "name": "Nychan Sopheakmanich",
    "department": "Industrial Engineering",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
    {
    "employeeId": "52521376",
    "name": "Nhen Pheaom",
    "department": "Industrial Engineering",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
    {
    "employeeId": "52521377",
    "name": "Thy Chivaon",
    "department": "Production Planning",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
      {
    "employeeId": "52521427",
    "name": "Monyvirack Sathya",
    "department": "Industrial Engineering",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
      {
    "employeeId": "52521428",
    "name": "luy Samphors",
    "department": "Industrial Engineering",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
      {
    "employeeId": "52521442",
    "name": "Nhouk Chhin",
    "department": "Shipping",
    "contactNumber": "00000000000",
    "telegramChatId": "1084330819",
    "isActive": true
  },
        {
    "employeeId": "52521462",
    "name": "Bou Malet",
    "department": "Production Planning",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
        {
    "employeeId": "52510015",
    "name": "Moragolle Gedara Ruchira Sampath Chandrarathna",
    "department": "Management Production",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
        {
    "employeeId": "52510016",
    "name": "Mabini  Descalso Ma. Franchezka",
    "department": "Management Production",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
          {
    "employeeId": "52510017",
    "name": "Arenas Laurente Edlen",
    "department": "Management Production",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
          {
    "employeeId": "52510018",
    "name": "Cantorni Crispina Savellano",
    "department": "Management Production",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
            {
    "employeeId": "52510020",
    "name": "RANASINGHE KANKANAMAGE LAKSHMAN",
    "department": "Management Production",
    "contactNumber": "00000000000",
    "telegramChatId": "",
    "isActive": true
  },
  {
    "employeeId": "52620009",
    "name": "Heng Samedy",
    "department": "HR and Payroll",
    "contactNumber": "015506272",
    "telegramChatId": "656461820",
    "isActive": true
  },
    {
    "employeeId": "52620001",
    "name": "Neang Chiva",
    "department": "Industrial Engineering",
    "contactNumber": "0000000000",
    "telegramChatId": "",
    "isActive": true
  },
      {
    "employeeId": "52620007",
    "name": "Roeun Danith",
    "department": "Merchandise",
    "contactNumber": "0000000000",
    "telegramChatId": "",
    "isActive": true
  },
        {
    "employeeId": "52620008",
    "name": "Horn Ivleang",
    "department": "Merchandise",
    "contactNumber": "0000000000",
    "telegramChatId": "",
    "isActive": true
  },
          {
    "employeeId": "52620010",
    "name": "Leb Samnang",
    "department": "Production Planning",
    "contactNumber": "0000000000",
    "telegramChatId": "",
    "isActive": true
  },
]
}

/* ───────── Seeding runner ───────── */
async function seed() {
  console.log('🔌 Connecting to MongoDB...')
  await mongoose.connect(MONGO_URI)

  const rawEmployees = loadEmployees()

  const employees = []
  const skipped = []

  for (const row of rawEmployees) {
    const emp = normalizeRow(row)
    if (!emp.employeeId || !emp.name) {
      skipped.push({ row, reason: 'Missing employeeId or name' })
      continue
    }
    employees.push(emp)
  }

  if (!employees.length) {
    console.error('❌ No valid employees to seed.')
    if (skipped.length) console.error('Skipped examples:', skipped.slice(0, 3))
    await mongoose.disconnect()
    process.exit(1)
  }

  // Bulk upsert (✅ ensures update of telegramChatId too)
  const ops = employees.map((emp) => ({
    updateOne: {
      filter: { employeeId: emp.employeeId },
      update: { $set: emp },
      upsert: true
    }
  }))

  console.log(`🧱 Upserting ${ops.length} employees...`)
  const res = await EmployeeDirectory.bulkWrite(ops, { ordered: false })

  console.log('✅ Bulk result:', {
    matched: res.matchedCount,
    modified: res.modifiedCount,
    upserted: res.upsertedCount || (res.upsertedIds ? Object.keys(res.upsertedIds).length : 0)
  })

  if (skipped.length) {
    console.log(`⚠️ Skipped ${skipped.length} rows (showing up to 5):`)
    for (const s of skipped.slice(0, 5)) {
      console.log(' - reason:', s.reason, ' row:', s.row)
    }
  }

  await mongoose.disconnect()
  console.log('🎉 Done seeding employees.')
}

/* ───────── Run ───────── */
seed().catch(async (err) => {
  console.error('❌ Error seeding employees:', err)
  try { await mongoose.disconnect() } catch {}
  process.exit(1)
})