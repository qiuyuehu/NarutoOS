// Verbatim official cookie restoration; synthetic cookie and UI stubs live in the harness.
function getLoginuserByCookie(oas_user) {
    var url = '//passport.oasgames.com/';
    var para = "m=getLoginUser&oas_user=" + oas_user + "&callback=?";
    $.ajax({
        'url': url,
        'async': false,
        'data': para,
        'dataType': 'json',
        'success': function (rs) {

            if (rs.status == 'ok') {
                //闁活潿鍔嶉崺娑欑┍閳╁啩绱�
                var userinfo = rs.val;
                var data = "uid=" + userinfo.id + "&gamecode=" + GameCode + "&callback=?";
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
            } else {
                $("#login_cont").html(befor_login_point());
            }
        }
    });
}
