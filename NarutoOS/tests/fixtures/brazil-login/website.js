// Regression fixture: verbatim password-login functions from the public official
// https://img.oasgames.com/uploads/171876913618164/server.js (2026-10-20).
// Retains the original repeated binding and missing error handlers. Only the
// unrelated success UI / cookie / credit functions below are synthetic stubs.
var GameCode = 'narutopt';
var tipsArray = {please_enter_uname:'Conta',please_enter_pwd:'Senha',not_userinfo:'Unknown account',wrong_password:'Wrong password',wrong_info:'Login failed'};
function setCookie() {} // No real account/session data.
function get_credit() {}
function after_login_point() { return '<div class="login_aft">Fixture logged in</div>'; }
function ajax_login() {
    var data = {};
    data.error = null;
    var email = $('input[name="oasun"]').val();
    var pwd = $('input[name="oaspd"]').val();
    var checked_pwd = $("#checkbox").attr('checked');
    var remember;
    if (checked_pwd == 'checked') {
        remember = 1;
    }
    var para = "m=login&email=" + encodeURIComponent(email) + "&pwd=" + encodeURIComponent(pwd) + "&remember=" + remember + "&callback=?";
    var url = '//passport.oasgames.com';

    var tips = $('.login_tips').hide();
    var top = 30;
    $.ajax({
        'url': url,
        'async': false,
        'data': para,
        'dataType': 'json',
        'success': function (rs) {
            if (rs.status == 'ok') {
                var userinfo = rs.val;
                var data = "uid=" + userinfo.id + "&gamecode=" + GameCode + "&callback=?";
                setCookie('oas_user', rs.val.loginKey);
                //闁哄牆绉存慨鐔煎闯閵娿倓绻嗛柟顓ㄦ嫹
                $.ajax({
                    'url': '//odp3.oasgames.com/api/game/get-user-servers?',
                    'async': false,
                    'data': data,
                    'dataType': 'json',
                    'success': function (rs) {
                        userinfo.server = rs;
                        $(".login_cont").html(after_login_point(userinfo));
                    }
                });

                //闁兼儳鍢茶ぐ鍥╃矓椤栨艾鐎荤紒娑橆槺妤狅拷
                get_credit();
            } else if (rs.err_code == 1) {
                data.error = 'oasun';
                top = 30;
                tips.css({top: top}).show().find('p').text(tipsArray.not_userinfo);
                return false;
            } else if (rs.err_code == 3) {
                data.error = 'oaspd';
                top = 76;
                tips.css({top: top}).show().find('p').text(tipsArray.wrong_password);
                return false;
            } else {
                data.error = 'oasun';
                top = 30,
                    tips.css({top: top}).show().find('p').text(tipsArray.wrong_info);
                return false;
            }
        }
    });
}

function keyLogin() {
    var event = window.event || arguments.callee.caller.arguments[0];
    var data = {};
    data.error = null;
    if (event.keyCode == 13) {
        var a = submits();
        if (a) {
            ajax_login();
        }
    }
}

function submits() {
    var $btn = $('.login_btn'),
        $username = $('input[name="oasun"]'),
        $password = $('input[name="oaspd"]'),
        $tips = $('.login_tips').hide();
    var username = $username.val(),
        password = $password.val(),
        top = 30,
        txt = tipsArray.please_enter_uname;
    if (!username) {
        data.error = 'oasun';
        $tips.css({top: top}).show().find('p').text(txt);
        return false;
    }
    if (!password) {
        data.error = 'oaspd';
        top = 76;
        txt = tipsArray.please_enter_pwd;
        $tips.css({top: top}).show().find('p').text(txt);
        return false;
    }
    return true;
}
;

function login() {
    var data = {};
    data.error = null;
    var $btn = $('.login_btn'),
        $username = $('input[name="oasun"]'),
        $password = $('input[name="oaspd"]'),
        $tips = $('.login_tips').hide();
    $btn.on('click', function () {
        var username = $username.val(),
            password = $password.val(),
            top = 30,
            txt = tipsArray.please_enter_uname;
        if (!username) {
            data.error = 'oasun';
            $tips.css({top: top}).show().find('p').text(txt);
            return;
        }
        if (!password) {
            data.error = 'oaspd';
            top = 76;
            txt = tipsArray.please_enter_pwd;
            $tips.css({top: top}).show().find('p').text(txt);
            return;
        }
        ajax_login();
    })
}
