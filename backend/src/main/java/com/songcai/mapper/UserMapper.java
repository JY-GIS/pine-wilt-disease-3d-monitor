package com.songcai.mapper;

import com.songcai.pojo.User;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface UserMapper {

    @Select("select user_id,username,phone from users order by user_id;")
    List<User> findAll();

    @Delete("delete from users where user_id = #{userId}")
    void deleteById(String userId);

    @Insert("insert into users(user_id, username, phone) values(#{userId},#{username},#{phone})")
    void addInfo(User user);

    @Select("select user_id,username,phone from users where user_id = #{userID}")
    List<User> getInfo(String userID);

    @Update("update users set username = #{username} where user_id = #{userId}")
    void updateName(@Param("userId") String userId,@Param("username") String name);

    @Update("update users set phone = #{phone} where user_id = #{userId}")
    void updatePhone(@Param("userId") String userId,@Param("phone") String phone);

    @Select("select * from users where username = #{username} and user_id = #{userId}")
    User selectByUsernameAndUserId(User user);

}
