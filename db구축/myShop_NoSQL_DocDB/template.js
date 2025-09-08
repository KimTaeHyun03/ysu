module.exports = {
  HTML: function (title, body, authStatusUI) {
    return `
      <!doctype html>
      <html>
      <head>
        <title>FASHION STORE - ${title}</title>
        <meta charset="utf-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
          body {
              font-family: 'Noto Sans KR', sans-serif;
              background-color: #f8f8f8;
              margin: 0;
              padding: 0;
              height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #333;
          }
          .background {
              background-color: white;
              width: 90%;
              max-width: 500px;
              padding: 40px;
              border-radius: 4px;
              box-shadow: 0 6px 30px rgba(0, 0, 0, 0.06);
              text-align: center;
          }
          .logo {
              margin-bottom: 25px;
              font-size: 22px;
              font-weight: 700;
              letter-spacing: 2px;
              color: #000;
          }
          form {
              display: flex;
              flex-direction: column;
              align-items: center;
              width: 100%;
          }
          .login {
              border: 1px solid #e0e0e0;
              background: white;
              padding: 14px 16px;
              margin: 8px 0;
              font-size: 14px;
              width: 100%;
              box-sizing: border-box;
              transition: all 0.2s ease;
          }
          .login:focus {
              outline: none;
              border-color: #000;
          }
          .btn {
              border: none;
              width: 100%;
              background-color: #000;
              color: white;
              padding: 16px 0;
              margin-top: 20px;
              font-weight: 500;
              font-size: 15px;
              letter-spacing: 1px;
              cursor: pointer;
              transition: all 0.3s ease;
          }
          .btn:hover {
              background-color: #333;
          }
          h2 {
              color: #000;
              font-weight: 500;
              font-size: 18px;
              margin-bottom: 30px;
              text-transform: uppercase;
              letter-spacing: 1.5px;
          }
          .status {
              color: #999;
              font-size: 13px;
              margin-bottom: 20px;
          }
          .footer {
              margin-top: 30px;
              font-size: 13px;
              color: #777;
          }
          .footer a {
              color: #000;
              text-decoration: none;
              font-weight: 500;
          }
          .footer a:hover {
              text-decoration: underline;
          }
          .divider {
              margin: 25px 0;
              height: 1px;
              background-color: #eee;
              width: 100%;
          }
          .social-login {
              display: flex;
              justify-content: center;
              gap: 15px;
              margin-top: 15px;
          }
          .social-btn {
              border: 1px solid #e0e0e0;
              background: white;
              width: 40px;
              height: 40px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              transition: all 0.2s;
          }
          .social-btn:hover {
              background-color: #f5f5f5;
          }
          
          /* 회원가입 페이지 스타일 */
          .input-group {
              width: 100%;
              margin-bottom: 20px;
              text-align: left;
          }
          .input-label {
              display: block;
              margin-bottom: 8px;
              font-size: 13px;
              font-weight: 500;
              color: #555;
          }
          .signup-input {
              border: 1px solid #e0e0e0;
              background: white;
              padding: 14px 16px;
              font-size: 14px;
              width: 100%;
              box-sizing: border-box;
              transition: all 0.2s ease;
          }
          .signup-input:focus {
              outline: none;
              border-color: #000;
          }
          .checkbox-group {
              display: flex;
              align-items: flex-start;
              width: 100%;
              margin: 10px 0;
              text-align: left;
          }
          .checkbox-group input {
              margin-top: 3px;
              margin-right: 10px;
          }
          .checkbox-group label {
              font-size: 13px;
              color: #555;
          }
          .checkbox-group label a {
              color: #000;
              text-decoration: none;
              font-weight: 500;
          }
          .checkbox-group label a:hover {
              text-decoration: underline;
          }
          .required {
              color: #ff3366;
              margin-left: 3px;
          }
        </style>
      </head>
      <body>
        <div class="background">
          ${authStatusUI}
          ${body}
        </div>
      </body>
      </html>
    `;
  }
};