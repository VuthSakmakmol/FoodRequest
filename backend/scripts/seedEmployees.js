// scripts/seedEmployees.js
/* eslint-disable no-console */
const path = require('path')
const fs = require('fs')
const mongoose = require('mongoose')
require('dotenv').config()

// Adjust this require path if your model lives elsewhere
const EmployeeDirectory = require('../models/EmployeeDirectory')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing in your .env')
  process.exit(1)
}

// Default JSON input path: projectRoot/staff1.json (put your exported JSON here)
const DEFAULT_JSON = path.resolve(__dirname, '../staff1.json')

// Optional: pass a custom file path: `node scripts/seedEmployees.js ./data/my_staff.json`
const ARG_PATH = process.argv[2] ? path.resolve(process.argv[2]) : null
const INPUT_PATH = ARG_PATH || DEFAULT_JSON

/** Map a raw row (from JSON) into our canonical employee object */
function normalizeRow(row) {
  // ID
  const employeeId = String(
    row.employeeId ??
    row.EmployeeID ??
    row.EMPLOYEE_ID ??
    row.ID ??
    row.Id ??
    ''
  ).trim()

  // Name
  const name = (
    row.name ??
    row.Name ??
    row.FullName ??
    row['Full Name'] ??
    row['Employee Name'] ??
    ''
  ).toString().trim()

  // Department
  const department = (
    row.department ??
    row.Department ??
    row.Dept ??
    row['Department Name'] ??
    'Unknown'
  ).toString().trim()

  // Contact number (flexible: E.164 or local)
  const contactNumber = (
    row.contactNumber ??
    row.ContactNumber ??
    row['Contact Number'] ??
    row.Phone ??
    row.Mobile ??
    row['Phone Number'] ??
    ''
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

  // Return normalized record
  return { employeeId, name, department, contactNumber, isActive }
}

/** Load employees array: prefer JSON file if present, else fallback array */
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
    "employeeId": "51310021",
    "name": "Wuranee Kingphetstereechon",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  {
    "employeeId": "51510016",
    "name": "Kanlayakorn Phantakod",
    "department": "General",
    "contactNumber": "051 581 405",
    "isActive": true
  },
  {
    "employeeId": "51810019",
    "name": "Nirut Sappaso",
    "department": "General",
    "contactNumber": "016 240 602",
    "isActive": true
  },
  {
    "employeeId": "51710019",
    "name": "Jonathan Tonga quinones",
    "department": "General",
    "contactNumber": "017 905 635",
    "isActive": true
  },
  {
    "employeeId": "52010001",
    "name": "Warachen Hongsa",
    "department": "General",
    "contactNumber": "010 742 730",
    "isActive": true
  },
  {
    "employeeId": "51910018",
    "name": "Atittaya Rojthammaruk",
    "department": "General",
    "contactNumber": "070 431 378",
    "isActive": true
  },
  {
    "employeeId": "51810024",
    "name": "Sangwan Nonphonkrang",
    "department": "General",
    "contactNumber": "096 889 9675",
    "isActive": true
  },
  {
    "employeeId": "51210010",
    "name": "Banchong Kaeokanda",
    "department": "General",
    "contactNumber": "061 277 577",
    "isActive": true
  },
  {
    "employeeId": "51210015",
    "name": "Uraiporn Rueangsri",
    "department": "General",
    "contactNumber": "051 581 4058",
    "isActive": true
  },
  {
    "employeeId": "51210018",
    "name": "Ninart Kongjaroen",
    "department": "General",
    "contactNumber": "070 825 643",
    "isActive": true
  },
  {
    "employeeId": "51910013",
    "name": "Haupe Liyanahe Sanjaya Bhadrajith",
    "department": "General",
    "contactNumber": "096 403 9826",
    "isActive": true
  },
  {
    "employeeId": "51210020",
    "name": "Pollawut Patumpattanakit",
    "department": "General",
    "contactNumber": "096 470 7019",
    "isActive": true
  },
  {
    "employeeId": "51210024",
    "name": "Joel Tautoan Arcayan",
    "department": "General",
    "contactNumber": "016 694 422",
    "isActive": true
  },
  {
    "employeeId": "51910001",
    "name": "Chirarot  Suroram",
    "department": "General",
    "contactNumber": "092 750 856",
    "isActive": true
  },
  {
    "employeeId": "51210027",
    "name": "Chantip Jithaisong",
    "department": "General",
    "contactNumber": "096 641 8799",
    "isActive": true
  },
  {
    "employeeId": "51210028",
    "name": "Saard Kaeokanda",
    "department": "General",
    "contactNumber": "061 832 908",
    "isActive": true
  },
  {
    "employeeId": "51210032",
    "name": "Nares Samoemuean",
    "department": "General",
    "contactNumber": "096 889 9675",
    "isActive": true
  },
  {
    "employeeId": "51210034",
    "name": "Cabiding Ricardo III Bugto",
    "department": "General",
    "contactNumber": "012-231 925",
    "isActive": true
  },
  {
    "employeeId": "51210038",
    "name": "Sompong Thanee",
    "department": "General",
    "contactNumber": "017 922 956",
    "isActive": true
  },
  {
    "employeeId": "51210039",
    "name": "Boonmee Promsungyang",
    "department": "General",
    "contactNumber": "096 881 7649",
    "isActive": true
  },
  {
    "employeeId": "51210040",
    "name": "Kraingkrai Yubunchai",
    "department": "General",
    "contactNumber": "096 8316562",
    "isActive": true
  },
  {
    "employeeId": "51410011",
    "name": "Pittaya Kerdsriphan",
    "department": "General",
    "contactNumber": "092 694 029",
    "isActive": true
  },
  {
    "employeeId": "51410012",
    "name": "Evangeline Flores Igos",
    "department": "General",
    "contactNumber": "085 958 954",
    "isActive": true
  },
  {
    "employeeId": "51410014",
    "name": "Boonkiat Jungsaisawangphan",
    "department": "General",
    "contactNumber": "81284523",
    "isActive": true
  },
  {
    "employeeId": "51710020",
    "name": "Lalita Yena",
    "department": "General",
    "contactNumber": "086 536 673",
    "isActive": true
  },
  {
    "employeeId": "51510015",
    "name": "Sompan Purampha",
    "department": "General",
    "contactNumber": "081 491 431",
    "isActive": true
  },
  {
    "employeeId": "51510017",
    "name": "Nukai Murachai",
    "department": "General",
    "contactNumber": "010 679 360",
    "isActive": true
  },
  {
    "employeeId": "51910016",
    "name": "Pisitsan Sata",
    "department": "General",
    "contactNumber": "096-5315658",
    "isActive": true
  },
  {
    "employeeId": "51510018",
    "name": "Sai Ninlaphat",
    "department": "General",
    "contactNumber": "070 816 494",
    "isActive": true
  },
  {
    "employeeId": "51510019",
    "name": "Dino Kristopher Guiam",
    "department": "General",
    "contactNumber": "096 490 7680",
    "isActive": true
  },
  {
    "employeeId": "51510023",
    "name": "Ratri Phunsahwat",
    "department": "General",
    "contactNumber": "096 376 5290",
    "isActive": true
  },
  {
    "employeeId": "51510024",
    "name": "Wichai Phuangphila",
    "department": "General",
    "contactNumber": "099 217 362",
    "isActive": true
  },
  {
    "employeeId": "51610014",
    "name": "Wasan Nonphonkrang",
    "department": "General",
    "contactNumber": "+66 965706236",
    "isActive": true
  },
  {
    "employeeId": "51710015",
    "name": "Arthit Sahwatnathi",
    "department": "General",
    "contactNumber": "096-5697544",
    "isActive": true
  },
  {
    "employeeId": "51710016",
    "name": "Maria Rebecca Dionco Bracamonte",
    "department": "General",
    "contactNumber": "092 293 828",
    "isActive": true
  },
  {
    "employeeId": "51810010",
    "name": "Aldrin Emil Tipawan Dionco",
    "department": "General",
    "contactNumber": "017 922 956",
    "isActive": true
  },
  {
    "employeeId": "51910010",
    "name": "Ontog Jethro James Thomas Villanada",
    "department": "General",
    "contactNumber": "096 417 5349",
    "isActive": true
  },
  {
    "employeeId": "51810012",
    "name": "Anna Theresa Dionco Endangan",
    "department": "General",
    "contactNumber": "085650645 , 016698242",
    "isActive": true
  },
  {
    "employeeId": "51810016",
    "name": "Ananchanin Phekong",
    "department": "General",
    "contactNumber": "078 666 971",
    "isActive": true
  },
  {
    "employeeId": "51310010",
    "name": "Natthanich Wongsa-Inta",
    "department": "General",
    "contactNumber": "096-256 2923",
    "isActive": true
  },
  {
    "employeeId": "51910006",
    "name": "Niratchadaporn  Tangjai",
    "department": "General",
    "contactNumber": "096 767 0603",
    "isActive": true
  },
  {
    "employeeId": "51810018",
    "name": "Gurusamy Thangapandi",
    "department": "General",
    "contactNumber": "081 493 612",
    "isActive": true
  },
  {
    "employeeId": "51810025",
    "name": "Ati Klinhomruen",
    "department": "General",
    "contactNumber": "070 820 147",
    "isActive": true
  },
  {
    "employeeId": "51810026",
    "name": "Bracamonte Justo Mark",
    "department": "General",
    "contactNumber": "089 645 200",
    "isActive": true
  },
  {
    "employeeId": "51910004",
    "name": "Dionco Descalso Aldrich Thristan",
    "department": "General",
    "contactNumber": "092 750 856",
    "isActive": true
  },
  {
    "employeeId": "51910011",
    "name": "Shinnasorn Phimphasoot",
    "department": "General",
    "contactNumber": "089 333 785",
    "isActive": true
  },
  {
    "employeeId": "51910012",
    "name": "Arcayan Chona Mantos",
    "department": "General",
    "contactNumber": "017 245 475",
    "isActive": true
  },
  {
    "employeeId": "51910017",
    "name": "Pathinya Chinnaruk",
    "department": "General",
    "contactNumber": "081 491 431",
    "isActive": true
  },
  {
    "employeeId": "51910019",
    "name": "Castaneda Joven Teodosio",
    "department": "General",
    "contactNumber": "092694029",
    "isActive": true
  },
  {
    "employeeId": "51910020",
    "name": "Aiyarat Kittitanakasame",
    "department": "General",
    "contactNumber": "096 8316562",
    "isActive": true
  },
  {
    "employeeId": "52010002",
    "name": "Nipaporn Jaras",
    "department": "General",
    "contactNumber": "092 478 818",
    "isActive": true
  },
  {
    "employeeId": "52010003",
    "name": "Amores Dexter Laurence Inderio",
    "department": "General",
    "contactNumber": "096 420 5783",
    "isActive": true
  },
  {
    "employeeId": "52010004",
    "name": "Durola Danilo Ochia",
    "department": "General",
    "contactNumber": "089-210-361",
    "isActive": true
  },
  {
    "employeeId": "52010005",
    "name": "De leon Marlon Pena",
    "department": "General",
    "contactNumber": "096 422 0255",
    "isActive": true
  },
  {
    "employeeId": "52010006",
    "name": "Pisiao Mala Elorde",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  {
    "employeeId": "52010007",
    "name": "Dolf Sugiharto",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  {
    "employeeId": "52110001",
    "name": "JETHRO JAMES THOMAS",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  {
    "employeeId": "52110002",
    "name": "MABINI DESCALSO MA. FRANCHEZKA",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  {
    "employeeId": "52110003",
    "name": "Sappaso Nirut",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  {
    "employeeId": "52110004",
    "name": "PARINYA  SAMMO",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  {
    "employeeId": "52110006",
    "name": "AGTAS KIMBERLY",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  {
    "employeeId": "52110008",
    "name": "MEEDEE THONGTORN",
    "department": "General",
    "contactNumber": "00000000",
    "isActive": true
  },
  { employeeId: '51220526', name: 'Phorn Theavy', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '51221200', name: 'Srun Socheat', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '51620103', name: 'Naran Phoumiseth', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '51921076', name: 'Huot Sievei', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '52020316', name: 'Proeurn Soknang', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320794', name: 'Vong Chanthoeun', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420147', name: 'Chhoun Sodavan', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520296', name: 'Phon Sreynin', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520582', name: 'Vann Vipha', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520624', name: 'Vorn Sothean', department: 'Accounting & Financial', isActive: true, contactNumber: '000000000' },

    { employeeId: '52420820', name: 'Chorn Lakena', department: 'Adminstration', isActive: true, contactNumber: '000000000' },

    { employeeId: '51220018', name: 'Pok Map', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '51220831', name: 'Yorn Sokhim', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '51220859', name: 'Sam Sambat', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '51420303', name: 'Mao Malybella', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '51820275', name: 'Kim Sokreaksmey', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '51820386', name: 'Srun Rida', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '51821047', name: 'Sot Sreynit', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52020942', name: 'Suon Tithyamatinine', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52120446', name: 'Lit Sony', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52120644', name: 'Heng Soksang', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320614', name: 'Mai Malen', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320615', name: 'Lor Mengkong', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320660', name: 'Yim Siphea Van', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320793', name: 'Eoun Sochetra', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420937', name: 'Sim Sreynech', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52421351', name: 'Seang Rachana', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52421482', name: 'Van Kakada', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520078', name: 'Vat Sotheavy', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520240', name: 'Morm Soriya', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520244', name: 'Leng Puthy', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520298', name: 'Lip Kimleang', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520299', name: 'Say Somalin', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520351', name: 'Vuth Sakmakmol', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520651', name: 'Sok Sreyroth', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520684', name: 'Phin SamPhosh', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520977', name: 'Thol Chhorla', department: 'HR and Payroll', isActive: true, contactNumber: '000000000' },

    { employeeId: '51220041', name: 'Hamit Askollany', department: 'IT Support', isActive: true, contactNumber: '000000000' },
    { employeeId: '51921385', name: 'Nom Sokkeo', department: 'IT Support', isActive: true, contactNumber: '000000000' },

    { employeeId: '51220670', name: 'Soun Channa', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '51520390', name: 'Hot Lyheng', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '51720462', name: 'Sun Sokhour', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '51720602', name: 'Khoeun Chanmakara', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '51821314', name: 'Khan Sreysros', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '52120926', name: 'Set Reaksmey', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220264', name: 'Chheun Kakta', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '52221421', name: 'Jean Chantourng', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320830', name: 'Sat Ratha', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520182', name: 'Yun Buntheng', department: 'Shipping', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520617', name: 'Soem Kungkiet', department: 'Shipping', isActive: true, contactNumber: '000000000' },

    { employeeId: '51321149', name: 'Sao Saren', department: 'Adicomp', isActive: true, contactNumber: '000000000' },
    { employeeId: '51720683', name: 'Chheng Ratanakchakreya', department: 'Adicomp', isActive: true, contactNumber: '000000000' },
    { employeeId: '52020835', name: 'Moa Kimleang', department: 'Adicomp', isActive: true, contactNumber: '000000000' },
    { employeeId: '52221210', name: 'Yong Laihea', department: 'Adicomp', isActive: true, contactNumber: '000000000' },

    { employeeId: '51320263', name: 'Young Bunthoeu', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '51321118', name: 'Ken Sophea', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '51321473', name: 'Tuy Sokchoeurn', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '51520172', name: 'An Kosal', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '51520758', name: 'Chheng Socheata', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '51820057', name: 'Khiev Rinnaro', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '51820306', name: 'Heang Vuchnear', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '51820541', name: 'Mao Daly', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '51920974', name: 'Sim Veasna', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220001', name: 'Houn Pisey', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220197', name: 'Dim Kunthearat', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220481', name: 'Touch Phors', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320475', name: 'Sawaengdee Siriphon', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320476', name: 'Prak Seryrith', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420330', name: 'Hum Sivorn', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420710', name: 'Pich Nyrachana', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52421102', name: 'Lory Long Y', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520001', name: 'Srean Thavy', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520236', name: 'Thouy Sonika', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520428', name: 'Ny Pheakdey', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520531', name: 'Sak Sopheary', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520554', name: 'Seng Sokpisey', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520683', name: 'Long Sreymean', department: 'Merchandise', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520812', name: 'Sum Vandoeun', department: 'Merchandise', isActive: true, contactNumber: '000000000' },

    { employeeId: '51220044', name: 'Sam Saret', department: 'Accessory Warehouse', isActive: true, contactNumber: '000000000' },
    { employeeId: '51220045', name: 'Ean Socheata', department: 'Accessory Warehouse', isActive: true, contactNumber: '000000000' },
    { employeeId: '52421285', name: 'Leang Mengly', department: 'Accessory Warehouse', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520600', name: 'Om Veasna', department: 'Accessory Warehouse', isActive: true, contactNumber: '000000000' },

    { employeeId: '52520782', name: 'Nour Phalla', department: 'Cutting', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520990', name: 'Lun Tola', department: 'Cutting', isActive: true, contactNumber: '000000000' },

    { employeeId: '51820960', name: 'Satt Romnear', department: 'Fabric Warehouse', isActive: true, contactNumber: '000000000' },
    { employeeId: '51821309', name: 'Phon Chandy', department: 'Fabric Warehouse', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320001', name: 'Ly Leng Gech', department: 'Fabric Warehouse', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520349', name: 'Trouy Lyching', department: 'Fabric Warehouse', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520499', name: 'Chrev Ahdit', department: 'Fabric Warehouse', isActive: true, contactNumber: '000000000' },

    { employeeId: '51720403', name: 'Cheab Da', department: 'Finishing Goods', isActive: true, contactNumber: '000000000' },
    { employeeId: '51820361', name: 'Meas Ping', department: 'Finishing Goods', isActive: true, contactNumber: '000000000' },

    { employeeId: '51321479', name: 'Chhith Sakminea', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '51921289', name: 'Vann Vannak', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52020705', name: 'Yoeurn Sokmy', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52120531', name: 'Sok Phana', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220298', name: 'Lun Sokha', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52221310', name: 'Leang Phayna', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420161', name: 'Yen Socheat', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420316', name: 'Larch Sokha', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420748', name: 'Bun Sros', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52421265', name: 'Nong Yang', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520297', name: 'Larch Sophy', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520424', name: 'Sam Leaknika', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520425', name: 'Vin Kalyan', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520426', name: 'Sreng Chakreya', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520621', name: 'Ut Vanndy', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520795', name: 'Huon Bonnanath', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520874', name: 'Von Mithona', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520927', name: 'Han Daven', department: 'Industrial Engineering', isActive: true, contactNumber: '000000000' },

    { employeeId: '51720078', name: 'Sreem Leanghoun', department: 'Pattern & Marker', isActive: true, contactNumber: '000000000' },

    { employeeId: '51220068', name: 'Pen Vanny', department: 'Production Planning', isActive: true, contactNumber: '000000000' },
    { employeeId: '51420165', name: 'Dom Lim', department: 'Production Planning', isActive: true, contactNumber: '000000000' },
    { employeeId: '52021058', name: 'Pich Lun', department: 'Production Planning', isActive: true, contactNumber: '000000000' },

    { employeeId: '51220876', name: 'San SamNang', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '51320096', name: 'Sreang Vuthy', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '51320106', name: 'Yan Seivhour', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '51420067', name: 'Nhoeurng Sophal', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '51820876', name: 'Kon Rothana', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '51820978', name: 'Khut Panha', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52120017', name: 'Suy Sreyleak', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52120889', name: 'Sokhom Sreyya', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220317', name: 'Nang Sreynich', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220340', name: 'Ly Chhayna', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220351', name: 'Nen Linda', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220457', name: 'Sam Sereythanit', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52221203', name: 'Sov Dany', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52221270', name: 'Prak Raksa', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320443', name: 'Bros Vecheka', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320784', name: 'Meung Muoykea', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420262', name: 'Chea Phavy', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420271', name: 'Seth Sorphy', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420384', name: 'Chhem Monseu', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420680', name: 'Kou Sophy', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420692', name: 'Yom Salina', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420902', name: 'Chin Sonita', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52421269', name: 'Thet Sreynet', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520069', name: 'Seng Hanna', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520097', name: 'Leng Sreylim', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520321', name: 'Thoeun Sokkhim', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520510', name: 'Keo Daro', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520511', name: 'Chhoun Srey Lim', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520536', name: 'Tam Sreysor', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520553', name: 'Chea Savy', department: 'Quality Assurance', isActive: true, contactNumber: '000000000' },

    { employeeId: '51820093', name: 'Puon Sokna', department: 'Quality Control', isActive: true, contactNumber: '000000000' },
    { employeeId: '52320381', name: 'Samnang Monyroth', department: 'Quality Control', isActive: true, contactNumber: '000000000' },

    { employeeId: '51220011', name: 'Se Bunthoeun', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51220059', name: 'Meach Kosorl', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51220212', name: 'Prum Savy', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51220213', name: 'Seak Sokhorn', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51220270', name: 'Thol SreyViet', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51220759', name: 'Suon Noeun', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51221285', name: 'Samret Sokhom', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51320029', name: 'Lun Sopheap', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51320332', name: 'Sun SreyPov', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51420870', name: 'Yun Sokim', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51620625', name: 'Chhon Srey aun', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '51921366', name: 'Thim Phalla', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52030347', name: 'Huon Sreymech', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52121304', name: 'Ngim Chamnan', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220060', name: 'Hea Chanpanha', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220318', name: 'Thol Sreynor', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52220802', name: 'Suon Sokkheng', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52221372', name: 'Torn Sreytouch', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52420318', name: 'Chhoam Sreymom', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520361', name: 'Neth Vanna', department: 'Sewing', isActive: true, contactNumber: '000000000' },
    { employeeId: '52520586', name: 'Ly Sopheap', department: 'Sewing', isActive: true, contactNumber: '000000000' },
]
}

async function seed() {
  console.log('🔌 Connecting to MongoDB...')
  await mongoose.connect(MONGO_URI)

  const rawEmployees = loadEmployees()

  // Filter + prepare ops
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

  if (employees.length === 0) {
    console.error('❌ No valid employees to seed.')
    if (skipped.length) console.error('Skipped examples:', skipped.slice(0, 3))
    await mongoose.disconnect()
    process.exit(1)
  }

  // Upsert in bulk
  const ops = employees.map((emp) => ({
    updateOne: {
      filter: { employeeId: emp.employeeId },
      update: { $set: emp },
      upsert: true,
    },
  }))

  console.log(`🧱 Upserting ${ops.length} employees...`)
  const res = await EmployeeDirectory.bulkWrite(ops, { ordered: false })

  console.log('✅ Bulk result:', {
    matched: res.matchedCount,
    modified: res.modifiedCount,
    upserted: res.upsertedCount || (res.upsertedIds ? Object.keys(res.upsertedIds).length : 0),
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

seed().catch(async (err) => {
  console.error('❌ Error seeding employees:', err)
  try { await mongoose.disconnect() } catch {}
  process.exit(1)
})
